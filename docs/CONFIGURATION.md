# Configuration Reference

<!--
documentation-metadata
audience: operators; site reliability engineers; maintainers
owner: application operators
status: current
last-verified: 2026-09-05
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: D04 accepted from source review and deployment-practice confirmation for settings, precedence, authentication, SMTP, storage, and production safety; controlled execution tracked separately in D04V
source-anchors: src/modules/settings.ts; src/server.ts; src/app.ts; src/modules/email.ts; src/modules/oidc.ts; src/modules/lib/fileCommons.ts; src/modules/invoiceRetention.ts; src/modules/database/services/EventInvoiceService.ts; .github/workflows/ci.yml
next-review: D04V
-->

This is the canonical operator reference for Surveyor settings. Use it together with the
[operations runbook](OPERATIONS.md), [database guide](DATABASE.md), and [upgrade procedure](UPGRADING.md).

## Production baseline

A production instance should have all of the following before it is started:

- A pre-created settings file selected with `SETTINGS_FILE` and readable only by the service account.
- A stable, high-entropy `SESSION_SECRET` that is not the generated placeholder.
- A dedicated MariaDB database and credentials.
- A public `ROOT_URL` using HTTPS and no trailing slash.
- Persistent relative upload paths below `uploads/`.
- Working SMTP credentials if local registration, password reset, guest recovery, or notifications are used.
- At least one full-account sign-in method: local login, OpenID Connect, or both.
- Legal URLs that point to the deployment's actual imprint and privacy information.

Do not start a production service from an unreviewed automatically generated settings file. When a settings file is
missing, the application writes its built-in defaults in normal runtime modes. Those defaults are suitable only as a
template and contain placeholder hosts, credentials, URLs, and a generated session secret.

## How settings are loaded

Surveyor builds one settings object in this order, from lowest to highest precedence:

1. Built-in defaults from `src/modules/settings.ts`.
2. Values in the selected CSV settings file.
3. Plain environment variables, including values loaded from the selected dotenv file.
4. In E2E mode only, matching `E2E_` environment variables override their plain counterparts.

The operating system environment has priority over a dotenv file because dotenv does not replace an already defined
process variable. Empty environment variables do not override a CSV value. Restart the process after any configuration
change.

### Selecting the settings and dotenv files

| Control | Meaning | Production guidance |
|---|---|---|
| `SETTINGS_FILE` | Path to the CSV settings file. The default is `./settings.csv`, resolved from the service working directory. | Set an explicit absolute path such as `/etc/surveyor/settings.csv`. |
| `NODE_ENV` | Runtime mode. `production` enables secure session cookies. `e2e` changes test-only loading behavior. | Set exactly `production`. |
| `.env` | Default dotenv file, resolved from the working directory. | Prefer service-manager environment entries plus the protected CSV file. Do not ship secrets in a release directory. |
| `E2E_DOTENV_FILE` | Selects a different dotenv file before settings are read. | Test-only; do not use for production operation. |
| `TZ` | Process timezone used by Node.js where code does not select one explicitly. | Use `UTC`; the database driver also treats timestamps as UTC. |

`PORT` is not a Surveyor setting. Use `APP_PORT`.

### CSV format

The file has no header. Each non-empty line contains an uppercase key, a comma, and the value:

```csv
APP_NAME,Surveyor
ROOT_URL,https://surveyor.example.org
APP_PORT,3000
```

The first comma separates the key from the value; later commas remain part of the value. Keys are trimmed, but values
are otherwise used as written. Do not add comments or quote syntax—the loader does not define either. Unknown keys are
ignored with a warning in the process log.

Recommended encoding and permissions:

```bash
install -o surveyor -g surveyor -m 0600 /dev/null /etc/surveyor/settings.csv
```

For Boolean settings, use `true` or `false`. The loader treats `1`, `true`, `yes`, and `on`, case-insensitively, as true;
any other non-empty value becomes false. Number settings are parsed with JavaScript numeric conversion; use plain decimal notation and validate the resulting
value. In particular, `INVOICE_RETENTION_MONTHS` must be a non-negative integer or startup fails before the HTTP
listener is opened.

## Example production settings file

Replace every placeholder before use. Keep `INVOICE_DIR` and `HEADER_IMG_DIR` relative to the application working
directory and below `uploads/`; the [operations runbook](OPERATIONS.md#persistent-files) shows a persistent symlink
layout.

```csv
APP_NAME,Surveyor
ROOT_URL,https://surveyor.example.org
APP_PORT,3000
SESSION_SECRET,replace-with-a-long-random-secret

DB_TYPE,mariadb
DB_HOST,127.0.0.1
DB_PORT,3306
DB_NAME,surveyor
DB_USER,surveyor
DB_PASSWORD,replace-with-the-database-password

SMTP_POOL,true
SMTP_HOST,smtp.example.org
SMTP_PORT,465
SMTP_SECURE,true
SMTP_EMAIL,Surveyor <surveyor@example.org>
SMTP_USER,surveyor@example.org
SMTP_PASSWORD,replace-with-the-smtp-password
EMAIL_ACCENT_COLOR,#6d5dfc

LOCAL_LOGIN_ENABLED,true
OIDC_ENABLED,false
OIDC_NAME,Organization sign-in
OIDC_CLIENT_ID,replace-when-oidc-is-enabled
OIDC_CLIENT_SECRET,replace-when-oidc-is-enabled
OIDC_ISSUER_BASE_URL,https://identity.example.org
OIDC_REDIRECT_URL,https://surveyor.example.org/users/oidc/callback

INVOICE_DIR,uploads/invoices/
INVOICE_RETENTION_MONTHS,6
HEADER_IMG_DIR,uploads/headerImgs/

IMPRINT_URL,https://www.example.org/imprint
PRIVACY_POLICY_URL,https://www.example.org/privacy

ACTIVITY_AVAILABILITY_WEIGHT,0.30
ACTIVITY_SWAP_OPTIMIZATION_ITERATIONS,10
ACTIVITY_ARRIVAL_DEPARTURE_PENALTY,0.2
```

## Complete setting inventory

The tables below contain every key accepted by the production settings loader. The defaults are the coherent working
contract used by this documentation; production rules identify defaults that must be replaced.

### Application and sessions

| Setting | Type | Built-in working default | Used for | Production rule |
|---|---|---|---|---|
| `APP_NAME` | String | `Surveyor` | Page and transactional-email branding. | Set the service name users recognize. |
| `ROOT_URL` | Absolute HTTP(S) URL | `http://localhost:3000` | Absolute activation, reset, event, email, logout, and navigation URLs; startup log label. | Set the exact public HTTPS origin without a trailing slash. |
| `APP_PORT` | Integer | `3000` | TCP port used by the Node HTTP listener. | Bind behind the reverse proxy and restrict direct network access. |
| `SESSION_SECRET` | Secret string | Generated `CHANGE__…` placeholder | Signs the session cookie; sessions themselves are stored in MariaDB. | Set a stable random secret before first start. Rotation signs users out and should be planned. |

### Database

| Setting | Type | Built-in default | Used for | Production rule |
|---|---|---|---|---|
| `DB_TYPE` | Enum: `mariadb` or `mysql` | `mariadb` | TypeORM database driver. | Use `mariadb` for the validated production baseline. |
| `DB_HOST` | Hostname or address | `localhost` | Runtime and wrapped migration database host. | Use the dedicated database endpoint; prefer a private network. |
| `DB_PORT` | Integer | `3306` | Database TCP port. | Match the MariaDB listener. |
| `DB_NAME` | String | `database` | Database/schema name. | Use a dedicated non-test database. |
| `DB_USER` | String | `user` | Database login. | Use a dedicated account with the privileges described in the [database guide](DATABASE.md). |
| `DB_PASSWORD` | Secret string | `password` | Database password. | Replace and protect it; do not expose it on a command line. |

The application does not run migrations automatically. Always use the repository's wrapped migration commands as
described in [Database and Migrations](DATABASE.md); those commands load this same settings contract before starting
the TypeORM CLI.

### SMTP and email branding

| Setting | Type | Built-in default | Used for | Production rule |
|---|---|---|---|---|
| `SMTP_POOL` | Boolean | `true` | Enables Nodemailer's SMTP connection pool. | Keep enabled for normal service use unless the SMTP provider requires one connection per message. |
| `SMTP_HOST` | Hostname | `smtp.example.com` | SMTP server. | Replace with the actual relay. |
| `SMTP_PORT` | Integer | `465` | SMTP port. | Match the relay and `SMTP_SECURE` mode. |
| `SMTP_SECURE` | Boolean | `true` | Uses TLS immediately when opening the SMTP connection. | Commonly true on port 465; use the exact provider setting. |
| `SMTP_EMAIL` | Mailbox or formatted sender | `test@example.com` | Message From address. A value already formatted as `Name <address>` is used as written; otherwise `APP_NAME` becomes the display name. | Use a verified sender accepted by the relay and receiving domains. |
| `SMTP_USER` | String | `username` | SMTP authentication name. | Replace with the relay credential. |
| `SMTP_PASSWORD` | Secret string | `password` | SMTP authentication secret. | Replace and protect it. |
| `EMAIL_ACCENT_COLOR` | Six-digit hex color | `#6d5dfc` | Buttons and accents in HTML service emails. | Use `#RRGGBB`; an invalid value falls back to `#6d5dfc`. |

Email delivery is initialized when the first message is sent, not during application startup. A successful health check
therefore does not prove that SMTP works. Complete the mail smoke tests in the [operations runbook](OPERATIONS.md#mail-and-sign-in-smoke-tests).

### Authentication

| Setting | Type | Built-in working default | Used for | Production rule |
|---|---|---|---|---|
| `LOCAL_LOGIN_ENABLED` | Boolean | `true` | Local registration, activation, username/password login, and password reset. | Keep enabled for local accounts or disable it only when OIDC is fully configured. |
| `OIDC_ENABLED` | Boolean | `false` | OpenID Connect sign-in. | Enable only after registering the client and callback with the provider. |
| `OIDC_NAME` | String | `OIDC Provider` | Label shown on the organization sign-in button. | Use the provider or organization name users recognize. |
| `OIDC_CLIENT_ID` | String | `CLIENT_ID` | OIDC client identifier. | Required when `OIDC_ENABLED=true`. |
| `OIDC_CLIENT_SECRET` | Secret string | `CLIENT_SECRET` | OIDC confidential-client secret. | Required when `OIDC_ENABLED=true`; protect and rotate according to provider policy. |
| `OIDC_ISSUER_BASE_URL` | Absolute HTTPS URL | `http://example.com` | Provider discovery URL. | Set the provider's issuer URL exactly; production providers should use HTTPS. |
| `OIDC_REDIRECT_URL` | Absolute HTTPS URL | `http://localhost:3000/users/oidc/callback` | Authorization-code callback sent to the provider. | Use the public `ROOT_URL` plus `/users/oidc/callback` and register the exact same URL with the provider. |

Supported sign-in combinations:

| Local login | OIDC | Result |
|---|---|---|
| Enabled | Disabled | Local accounts only. |
| Enabled | Enabled | Users may choose local or organization sign-in. |
| Disabled | Enabled | Organization sign-in for full accounts. Guest invitation and recovery flows remain part of the application. |
| Disabled | Disabled | No supported full-account sign-in path; do not deploy this combination. |

OIDC uses discovery, authorization code flow, PKCE, state validation, and the `openid email profile` scopes. The provider
must return a stable `sub` claim. Supplying email and profile claims improves account linking and profile creation.
Behind a proxy, preserve the public host and scheme as shown in the [reverse-proxy configuration](OPERATIONS.md#reverse-proxy-and-tls).

### Persistent files and retention

| Setting | Type | Built-in default | Used for | Production rule |
|---|---|---|---|---|
| `INVOICE_DIR` | Relative directory | `uploads/invoices/` | Uploaded invoice proof images and PDFs. | Keep it beneath relative `uploads/`; persist and back it up together with the database. |
| `INVOICE_RETENTION_MONTHS` | Non-negative integer | `6` | Removes invoice records and proof files for events whose end date reached the retention cutoff. | Select the approved retention period. Cleanup runs before the listener starts and hourly afterward. |
| `HEADER_IMG_DIR` | Relative directory | `uploads/headerImgs/` | Uploaded survey, event, activity-plan, packing-list, and drivers-list header images. | Keep it beneath relative `uploads/`; persist and back it up together with the database. |

Uploads are resolved from the process working directory. Header images accept JPEG, PNG, and GIF. Invoice proofs accept
those image formats plus PDF. The per-file limit is 10 MiB. These files are not disposable build artifacts.

### Legal links

| Setting | Type | Built-in default | Used for | Production rule |
|---|---|---|---|---|
| `IMPRINT_URL` | Absolute HTTP(S) URL | `http://example.com/imprint` | Footer and transactional-email imprint link. | Replace with the legally applicable page. |
| `PRIVACY_POLICY_URL` | Absolute HTTP(S) URL | `http://example.com/privacy` | Footer and transactional-email privacy link. | Replace with the deployment's privacy notice. |

### Activity-planning compatibility settings

| Setting | Type | Built-in default | Current contract | Production rule |
|---|---|---|---|---|
| `ACTIVITY_AVAILABILITY_WEIGHT` | Number | `0.30` | Accepted and retained by the settings loader as an activity-planning compatibility setting. | Keep the default unless a release explicitly documents changed scheduling behavior. |
| `ACTIVITY_SWAP_OPTIMIZATION_ITERATIONS` | Number | `10` | Accepted and retained by the settings loader as an activity-planning compatibility setting. | Keep the default unless a release explicitly documents changed scheduling behavior. |
| `ACTIVITY_ARRIVAL_DEPARTURE_PENALTY` | Number | `0.2` | Accepted and retained by the settings loader as an activity-planning compatibility setting. | Keep the default unless a release explicitly documents changed scheduling behavior. |

## Secret handling and rotation

Store the settings file outside the release directory, limit it to the service account, and include it only in encrypted
operator backups. Do not commit it, place it in `docs/`, or copy it into a support ticket.

- Rotating `SESSION_SECRET` invalidates existing signed cookies. Schedule it as a user sign-out event.
- Rotating database, SMTP, or OIDC credentials requires updating the external service and Surveyor configuration as one
  controlled change, followed by a restart and smoke test.
- A database restore includes the session table. Rotate `SESSION_SECRET` after a restore when restored sessions must not
  become usable again.
- Protect process logs: request logging includes request paths, and some one-time account and invitation flows use
  path-based tokens.

Generate a session secret with a cryptographically secure tool, for example:

```bash
openssl rand -base64 48
```

## Configuration validation checklist

Before making an instance reachable:

1. Confirm `SETTINGS_FILE` points to the intended protected file.
2. Verify the public origin, port, database name, and persistent relative upload paths.
3. Confirm the service account can read the configuration and write the persistent upload root.
4. Run the migration-target checks from [Database and Migrations](DATABASE.md#prove-the-migration-target).
5. Start the service with `NODE_ENV=production` and `TZ=UTC`.
6. Verify `/healthz`, the public page, one upload/download path, email delivery, and every enabled sign-in method.
7. Record the release version and a redacted configuration inventory in the operations log.
