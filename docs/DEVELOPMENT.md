# Development Guide
<!--
documentation-metadata
audience: developers; maintainers; AI agents
owner: developer-experience maintainers
status: current
last-verified: 2026-10-26
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: authorized source ownership, compiler scopes, generator/runtime paths and guarded asset delivery reconciled; prior rendering, responsiveness and domain contracts retained; no deployment or exhaustive verification claim
source-anchors: package.json; src/backend/app.ts; src/backend/server.ts; src/backend/modules/frontendAssets.ts; src/backend/modules/frontendRenderer.ts; src/frontend/; src/backend/routes/; src/backend/controller/; src/backend/modules/database/; src/backend/modules/api/; contracts/api/v1/; src/common/locales/; scripts/generate-api.mjs; scripts/generate-locales.mjs; scripts/check-development-policy.mjs; scripts/watch-frontend-inputs.mjs; vite.config.mts; vitest.config.mts; playwright.config.ts; playwright.frontend.config.ts; playwright.integration.config.ts; docs/decisions/DEC-006-FRONTEND-FRAMEWORK.md
next-review: development-workflow-or-help-tooling-change
-->

This guide covers a source-checkout development workflow for Surveyor. Production deployment and database maintenance use the separate [operator documentation](OPERATIONS.md).

## Prerequisites

Match the automated workflows unless a change explicitly targets another supported version:

- Node.js 24.15.0
- npm from that Node.js installation
- MariaDB 10.11
- Git

The project has no containerized application-development stack. `docker-compose.mariadb.test.yml` is a test-database convenience file, not a complete Surveyor environment.

## Clean-clone setup

### 1. Install dependencies

```bash
git clone https://github.com/JulianiusM/Surveyor.git
cd Surveyor
npm ci
```

Use `npm ci` for a clean checkout because `package-lock.json` is the dependency source used by CI and release builds. Use `npm install` only when intentionally changing dependency declarations and the lockfile.

TypeScript remains on 6.x because locale generation and the development checker consume its JavaScript compiler
and AST APIs. The native TypeScript 7 package does not provide a drop-in replacement for those exports. A compiler
upgrade must also validate these shared tooling owners, OpenAPI generation and Vue type checking; changing the
compiler version alone would break the current build/check workflow. The manifest and lockfile own exact versions.

### 2. Create a development database

Create an empty database and a dedicated development account. One example for a local TCP connection is:

```sql
CREATE DATABASE surveyor_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'surveyor_dev'@'127.0.0.1' IDENTIFIED BY 'replace-this-password';
GRANT ALL PRIVILEGES ON `surveyor\_dev`.* TO 'surveyor_dev'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Never point development reset or synchronization commands at a shared, staging, or production schema.

### 3. Create `.env`

The repository intentionally has no general environment example because the complete supported surface is generated from `src/backend/modules/settings.ts` and maintained in [Configuration Reference](CONFIGURATION.md). For a local account/password instance, this is the minimum practical starting point:

```dotenv
NODE_ENV=development
APP_PORT=3000
ROOT_URL=http://localhost:3000

DB_TYPE=mariadb
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=surveyor_dev
DB_USER=surveyor_dev
DB_PASSWORD=replace-this-password

SESSION_SECRET=replace-with-a-long-random-value
LOCAL_LOGIN_ENABLED=1
OIDC_ENABLED=0

SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=0
SMTP_POOL=0
SMTP_EMAIL=surveyor@example.test
SMTP_USER=surveyor
SMTP_PASSWORD=surveyor
```

Point SMTP at a development mail catcher or test service. Local registration, activation, password reset, guest recovery, and several workflow notifications depend on email.

For organization sign-in, configure `OIDC_ISSUER_BASE_URL`, the client credentials, and the other OIDC keys from the configuration reference, then register the callback path `/users/oidc/callback`. Local and OIDC login may be enabled together. At least one usable full-account login path should be configured for development.

Runtime settings use this precedence:

```text
built-in defaults < CSV settings file < environment overrides
```

Do not introduce a second settings loader or read configuration directly in feature code. The TypeORM command-line datasource is the controlled exception; `scripts/runMigration.ts` maps the initialized settings store to its expected `DB_*` variables.

### 4. Create the empty schema

The entity/migration index is generated and ignored, so a clean clone must generate it before a standalone TypeORM command:

```bash
npm run generate
npm run typeorm:sync
npm run typeorm:migrate
```

This sequence is only for a new empty disposable development database. `schema:sync` constructs the current entity schema; the migration run records and applies migrations needed for migration history, triggers, and conditional adjustments. Existing databases follow [Database and Migrations](DATABASE.md).

The convenience command below drops the selected schema first and is therefore destructive:

```bash
npm run typeorm:reset-db
```

Use it only after independently confirming that the selected database is disposable.

### 5. Start Surveyor

```bash
npm run server
```

`npm run server` prepares generated database/API/localization inputs and standalone print CSS once, then runs:

- Express under Nodemon through `npm run server:dev`, with Vite middleware/HMR; and
- serialized contract/catalog generation under `npm run server:frontend`.

Source development uses ts-node's transpile-only mode with the server compiler's decorator settings. Run the strict
server/frontend checks separately; release builds retain their full compilation, type checks and asset compression.
Development does not build or consume release client/SSR bundles. Before listening, it prepares the document's client
entry, linked stylesheet as direct CSS, static imports and source SSR definitions through Vite. Lazy domain views
remain demand loaded. Document delivery and warmup consume the same development asset inventory.

Authored inputs are `contracts/api/v1/`, `src/common/locales/` and the exact permission registry
`src/backend/modules/lib/permissions.ts`. The watcher observes the registry's parent so atomic editor replacement remains
visible, generates API before locales and publishes `.generated/frontend-ready.json` only after the current successful
batch. Failed or superseded batches keep watching without restarting Express with partial inputs. Other library
saves retain ordinary server restart behavior. Source serving explicitly uses `vite.config.mts` and the repository
root. Vite excludes ignored runtime evidence under `artifacts/`, alongside generated/build/test-output exclusions.
Application source uses normal HMR. Production runs matching built artifacts without a Vite server.

The development boundary admits only the maintained public source inventory and optimized browser dependencies.
Add browser-safe shared implementations to their actual `src/common/` owner; private server/session behavior belongs
in `src/backend/`. Backend compilation starts from those backend/common roots and the Express augmentation, loading
other declarations through their actual imports rather than compiling unrelated frontend modules.


Check the instance:

```bash
curl http://localhost:3000/healthz
```

A healthy process returns `ok`. Complete a local activation email or an OIDC login to verify the configured identity path.

## Project structure

```text
src/backend/server.ts                      ordered process bootstrap
src/backend/app.ts                         Express application and top-level route mounts
src/backend/routes/                        canonical document routes and standalone output adapters
src/backend/routes/api/v1/                 generated-contract feature API adapters
src/backend/routes/api.ts                  API version selection and early-error dispatch
src/backend/routes/api/v1.ts               version-specific domain composition
src/backend/controller/                    request and response orchestration
src/backend/middleware/                    shared request flows and authorization
src/backend/modules/database/entities/     TypeORM entities
src/backend/modules/database/services/     database and transaction functions
src/backend/modules/database/subscribers/  TypeORM subscribers
src/backend/migrations/                    TypeORM migrations
src/backend/modules/lib/                   private cross-feature utilities
src/backend/views/                         standalone Activity/Event print templates
src/frontend/                              Vue app, components, composables and feature views
src/common/                                browser-safe shared implementations
src/common/locales/                        shared UI/server catalogs
src/types/                                 shared .d.ts contracts
src/public/style/                          standalone print stylesheet
contracts/api/v1/                          authored API schema and operation policy

tests/unit/                        isolated production logic
tests/frontend/                    client helpers/mounted Vue and isolated browser checks
tests/integration/                 database-backed workflows and genuine isolated server-component integration
tests/e2e/                         Playwright critical flows
tests/factories/                   production-shaped test data
tests/keywords/                    reusable test workflows and assertions
tests/support/                     runner environment and database setup
docs/user-guide/                   canonical in-app help
docs/                              maintainer and operator documentation
```

`dist/`, compiled print CSS, generated contract/catalog consumers, uploads, local environment files, `settings.csv`, reports, and `src/backend/modules/database/__index__.ts` are ignored build/runtime outputs.

## Build and run commands

| Command | Behavior |
|---|---|
| `npm run server` | Prepare source-development inputs, then Express/Vite HMR and ordered authored-input generation. |
| `npm run prepare:dev` | Generate database/API/localization inputs and print CSS without release builds or type checking. |
| `npm run server:dev` | Nodemon + transpile-only ts-node server. It assumes generated database metadata and required assets already exist. |
| `npm run server:frontend` | Watch contracts, catalogs and permission declarations; publish successful generation readiness. |
| `npm run build` | Clean `dist/`, generate shared inputs, compile server and Vue client/SSR output, compile print CSS, then copy print views/shared assets. |
| `npm run build:clean` | Remove only the verified repository `dist/` output before the complete build. |
| `npm run build:print` | Compile the standalone print stylesheet into ignored CSS for development and release copying. |
| `npm run build:server` | Generate shared inputs, compile server TypeScript into `dist/` and copy runtime contract artifacts. |
| `npm run build:frontend` | Check and build the separate Vue client and SSR scopes through Vite. |
| `npm run typecheck:frontend` | Check both Vue client and SSR configurations. |
| `npm run typecheck:tests` | Check the Vue-aware test import graph without executing tests. |
| `npm run copy` | Copy shared images, print CSS and standalone Pug print templates into `dist/`. |
| `npm run run` | Start `dist/backend/server.js`; it does not build first. |
| `npm run generate` | Rebuild database metadata and API/localization consumers without a database connection. |
| `npm run prepare:frontend` | Generate the authored API and locale boundaries only. |

### Generated files

Do not hand-edit or commit these generated outputs:

- `src/backend/modules/database/__index__.ts`
- `.generated/api/` and `.generated/frontend-ready.json`
- `src/types/api/` generated declarations and `src/types/LocalizationTypes.d.ts`
- `src/common/localization/generated/`

- `src/public/style/print.css`
- `dist/`

Vite builds application browser assets; esbuild remains an internal dependency of the API validator generator.


Vite owns separate client/SSR outputs. Browser, server and SSR compiler scopes are explicit; no filesystem, settings
secret or ORM entity belongs in the browser graph. Client and SSR outputs use the same release/compilation mode.
Externalized SSR packages remain production dependencies; standalone validators include their runtime helpers
without compiling schemas at application startup.
Normal locale generation retires only its known compiled `permissions.js`/`.js.map` siblings before emitting current
`permissions.ts`, so extensionless imports cannot select stale emitted code. Exact output-root paths, entry types
and real parent containment are checked before removal. `--check` reports a collision without rewriting/deleting
files. Preserve the whole authored-tree collision regression and unrelated generated neighbors rather than adding
exclusions or general directory cleanup.

## Current code patterns

The repository is not governed by a single formatting tool or a class-per-file convention. Follow the neighboring production code and preserve these architectural boundaries.

### Readability and shared contracts

Human readability and the established application patterns are acceptance criteria, alongside DRY, separation of
concerns, a single source of truth, and information hiding. Preserve local indentation, spacing, wrapping, and naming.
Keep formatting changes within the work being reviewed.

Visual consistency is a core acceptance criterion across the application and its exports. Reuse established
components, spacing, typography, and interaction patterns before adding a feature-specific treatment. PDF sections
use the existing shared `sectionTitle` style and document conventions; formulas remain readable as one complete
equation per row. Any change affecting PDF output requires regeneration and visual inspection of every affected page
before another PDF-affecting change.

The [development policy](policies/DEVELOPMENT_POLICY.md#implementation-principles) owns the mandatory method-contract
and internal-comment rules. Apply them together: place purposeful comments at the meaningful
phases so a maintainer can follow input selection, checks, transformations, writes, side effects, and recovery in
execution order. Explain intent and constraints, especially transaction ordering, authorization, inherited state,
and exceptional behavior. Keep comments current; do not substitute a summary above the method for an explanation
inside it or repeat obvious expressions mechanically.

Vue templates and composables need equivalent explanations of explicit inputs, scoped data, meaningful branches,
draft/command lifetimes and DOM hooks. Document nontrivial methods with a contract and internal comments describing
their meaningful steps. Retained print Pug templates use unbuffered `//-` comments for their inputs and render branches;
optional feature state still uses renderer `data` and explicit arguments, never a second `res.locals` channel.

Use descriptive names, named helpers, and straightforward control flow. Avoid excessive anonymous functions, nested
lambdas, or chained transformations that make a workflow difficult to follow. Short callbacks remain useful for an
obvious mapping, predicate, or established framework boundary.

Re-exporting imported functions, values, or types is forbidden. Import directly from the module that owns the
implementation or declaration; do not introduce forwarding exports or barrel modules to preserve an old import path.

Once a feature has a central wording catalog, all of its visible messages, labels, help text, accessibility text,
validation feedback, emails, and exports must use it. Distributed feature strings are prohibited. Use stable typed
keys, complete messages with named parameters, and locale-aware plural forms; do not concatenate translated fragments,
insert English verbs, or append English plural suffixes. Select wording and plural rules from the same supported
catalog, with an explicit fallback. User-entered content and immutable historical notes remain data.

Shared type-only contracts belong in `.d.ts` files under `src/types/`, following the existing declaration-file pattern.
Executable constants and functions belong in `.ts` modules. Keep private implementation types and repository details
inside the module that owns them instead of exporting them merely to connect newly introduced layers.

### Routes

- Use `express.Router()` in a feature route module.
- Add canonical document entries to their domain module under `src/backend/routes/`; `src/backend/app.ts` owns the ordered domain mounts.
- Configure matching entity document/API/guest routes through `guestFlowFactory`, header mutations through
  `entityHeaderUpdateHandler`, and self-assignment routes through `assignFlowFactory`. Keep common HTTP pipelines in
  those middleware owners and domain checks/transactions in existing controllers/DBAL; preserve each operation's
  admission, receipt-preparation and upload-ownership order. Domain routers add their distinct extensions.
- Use `adminApiFactory` for the matching administrator, property, lifecycle and scoped profile-search routes;
  retain feature controller business operations and deliberate exceptions. Settings/default permissions and Event
  metadata remain distinct handlers. Each versioned entity domain mounts its guest-registration subrouter using the
  same configuration as document/core routes. Mount it after a feature error adapter so identity errors retain the
  common version error contract. The identity router must not import all entity configurations to compose their routes.
- Keep shared document admission, bootstrap and error helpers in `src/backend/middleware/frontendDocuments.ts` and
  header delivery in `entityHeaderDownloadHandler.ts`; shared middleware must not depend upward on route registries.
- Declare client paths, lazy views and static metadata in the matching domain under `src/frontend/routes/`; its index composes the records with the catch-all last.
- Mount the API root at `/api` in `app.ts`; `routes/api.ts` owns version selection, and each version router composes
  only its own domain routers. Keep endpoint implementations in those domain files. Wire early parser errors through
  the same version inventory, with no version-specific dispatcher in the application root.
  Document routes stay in their existing domain modules; each transport retains its admission/error boundary.

- Keep middleware order visible in the route definition.
- Reuse `modules/lib/http.requestLocale` for HTTP language negotiation. Generic last-resort delivery must remain
  independent of generated API response validation, including when error projection or localization itself fails.
- Wrap asynchronous request and parameter handlers with `asyncHandler` or `asyncParamHandler`.
- Reuse the configured guest-flow entry composition and the feature controller's business operations from both
  document and versioned adapters.
  Browser create, guest, duplicate and deletion flows use the existing shared Vue components and generated operations,
  with the feature's actual admission, fields and outcomes supplied explicitly.
- Preserve internal return navigation at login, registration and logout through `referrerUpdater`; explicit `next`
  retains precedence and the existing safe-return implementation bounds inferred destinations.

### Controllers and services

- Controllers normalize request data, coordinate services, prepare render data, and choose redirects/messages.
- Put business/authorization/validation checks and context-specific errors in the controller layer or its dedicated
  feature modules. Controllers orchestrate these modules and the existing services. Services must not
  throw `APIError`, `ExpectedError`, or other request/UI-specific errors: they are pure DBAL.
- Database services are functional database service modules that export functions; they do not require a service class or dependency-injection container.
- Extend an existing controller, service, or middleware module when the responsibility already belongs there. Keep cohesive operations together; a new module must have a distinct responsibility, not just forward calls to another module.
- Keep repository access and transactions in `src/backend/modules/database/services/` rather than routes or controllers or the feature modules they orchestrate.
- Expose operations that describe the domain workflow. Keep repository selection, query construction, and lock ordering private to the persistence boundary.
- Use a TypeORM transaction for multi-record writes that must succeed or fail together.
- For a rule requiring locked data, let the service own transaction creation and locking, then invoke a named
  operation from the corresponding controller or its feature module with the locked rows and manager. Checks and
  writes remain inside that transaction; never weaken atomicity by moving the check before lock acquisition.
- Preserve the distinction between account IDs, guest IDs, profile IDs, entity IDs, item IDs, and event-registration IDs.

Use the installed TypeORM 1.x APIs: query runners and query builders expose `dataSource`, and repository existence
checks use `exists` or `existsBy`. When replacing older names, preserve the query's conditions, relation loading,
selected columns and transaction manager. An API naming correction does not change DBAL ownership or authorize
different transaction and locking behavior.

### Authentication and permissions

- Local login, guest identity, and OIDC all converge on the session's active profile.
- The OIDC implementation uses `openid-client` directly and persists PKCE/state material in the database-backed session.
- Use the middleware exported by `src/backend/middleware/permissionMiddleware.ts`; do not invent a parallel authorization vocabulary.
- Page admission, action permission, entity ownership, item ownership, event participation, and delegated administration are separate checks.
- General permission grants combine cumulatively. Surveys intentionally use their own participation model. See [Permission-System Reference](PERMISSIONS_REFERENCE.md).

### Errors and responses

- Use the generated versioned contracts and `ApiProblem` boundary for ordinary browser commands.
- Retain feature drafts and present rejected, confirmed and uncertain outcomes through the shared Vue command and feedback owners.
- Existing shared controllers still throw `ValidationError`, `ExpectedError` and `APIError` where their operations require them.
  The established adapters classify those outcomes; their historical template data does not create a document-form workflow.
- Let the versioned error boundary produce validated localized problems and the canonical frontend router render ordinary document errors.
- Use the established page renderer and response adapters rather than create another response convention.

Versioned adapters use the generated request/result contracts and `ApiProblem` boundary. For new or deliberately
changed business behavior, prepare and validate a final mutation receipt before commit; a later mutable-context check
or session save must not reject an already committed operation. Scope-preserving consumers follow the
[existing-operation boundary](policies/DEVELOPMENT_POLICY.md#scope-of-separately-authorized-work) without requiring
unapproved legacy repairs. Delivery failure remains distinct from business rejection. Services never own
transport-specific errors.
The domain document routers use `src/backend/modules/frontendRenderer.ts` for Vue HTML and ordinary document
errors, reusing controller projections. The outer generic error handler supplies a localized private/no-store
plain-text response if parsing, session admission or rendering fails. Components do not duplicate business behavior.

### Components, contracts and browser state

Keep visible labels, field names, controllers and Help aligned. Features live under `src/frontend/features/`; their
`api.ts` owns generated operation/validator selection and uses `app/transport.ts`. Shared components/composables accept
explicit values, capabilities, events and injected operations. They own presentation/accessibility, not feature
endpoints or permission policy. The following contracts describe how those owners work together; the
[Architecture](ARCHITECTURE.md#frontend-architecture) defines the wider runtime boundary.

#### Ownership handoffs

| Handoff | Existing owner |
|---|---|
| Wire shape to generated types/validators | `contracts/api/v1/`, `scripts/generate-api.mjs`; import declaration contracts directly. |
| Business operation to permitted projection | Existing feature controller; transport adapters use its named operation and method policy. |
| Locked context to checks/write | Existing DBAL transaction/lock operation invokes a named controller callback. |
| DTO to browser operation | `features/<feature>/api.ts`, `app/transport.ts`, generated operation and feature validators. |
| Entry/read to authorized view | `composables/pageEntry.ts`, `app/queryKeys.ts`, `app/queryCache.ts`; the feature supplies policy/dependencies. |
| Snapshot to draft/command/recovery | `metadataDraft.ts`, `command.ts`, shared feedback, confirmed-navigation and fresh-read owners. |
| Matching detail read/command state to presentation | `useListDetail`/`useListCommands` retain lifetimes; `EntityDetailReadState`, `RefreshButton` and `CommandFeedback` render injected state/events without another query, draft or authority owner. |
| Matching entity interaction to its consumers | `EntityEntryPage`, `EntityHeader`, `EntitySettingsDialog`, `EntityMetadataEditor`, `EntityAccessEditor` and `identity/GuestEntryPage`; feature operations, query families and field normalization remain injected. |
| Route to SSR/hydration | Existing Express route/renderer, `app/serializeBootstrap.ts`, `createApp.ts` and `mountPreservingDrafts.ts`. |
| Initial content to usable controls | `app/context.ts` initialization helpers, route metadata and existing shell/shared controls. |
| Repeated interaction to presentation | Shared components/composables; explicit props/events and injected operations. |
| Language to UI/server/Help | Catalog, shared translator, i18next-vue and reviewed runtime corpus. |

Frontend paths in this table are relative to `src/frontend/`. Create a module only when an existing logical owner
cannot comfortably hold its responsibility. Do not add another router, HTTP wrapper, state store, controller,
validator or service simply to make this table symmetrical. Application presentation helpers and styles belong to
their existing owners under `src/frontend/`, with one implementation for matching consumers. Shared logo/favicon,
third-party dependencies and browser-safe backend/domain/catalog owners retain their actual shared ownership.

`CreationAdmissionNotices` shares read and submission-admission warning presentation across Survey, Event and list
creation. Callers pass errors, timestamps, retry actions and stale/cold classification; reads, drafts and commands
remain with their existing owners. Shared settings composes Access only when the feature supplies its complete
access operations and profile-query inputs as well as admitted server capabilities. Standalone Surveys supply none.
`CreationPermissions` composes the matching Event/list creation and duplicate audience matrices in a closed-by-default
disclosure. It keeps the controls mounted when closed; each form still owns masks, presets, admission and submission.
Reopening must retain the selected audience and all draft grants. Surveys retain their separate participation model.
Route metadata selects the shared loading composition for the actual module: Survey creation has three fields and
recurring-choice rows, while voting has separate ballot/results tables and a two-select combination form. Decorative
geometry introduces no controls, records or authority. Survey metadata ETags identify representations for draft
refresh; they do not strengthen its existing last-write persistence or non-atomic ballot replacement.

#### Contract authoring and generated consumers

Author wire shapes and operation policy once in OpenAPI 3.1.1 with JSON Schema draft 2020-12 under
`contracts/api/v1/`. The [framework decision](decisions/DEC-006-FRONTEND-FRAMEWORK.md#shared-api-contract-decision)
retains the original toolchain choice and alternatives; executable package scripts own exact dependency versions.

| Input or generated artifact | Responsibility |
|---|---|
| `openapi.yaml`, feature YAML and `common.yaml` | Operation IDs, paths, security, statuses, media, feature shapes and genuinely shared subshapes. |
| `.generated/api/v1/openapi.json` and `operations.json` | Bundled local description and derived operation/schema metadata; packaged with the matching server validators. |
| `src/types/api/v1.d.ts` and `validation-v1.d.ts` | Runtime-free wire declarations and validator signatures referring to those declarations. |
| `.generated/api/v1/server.cjs` and `browser/` | Standalone server validators and lazy browser validators compiled from the same authored constraints. |
| Existing server transport and feature `api.ts` | Decode declared transport, select generated validation and present outcomes around the existing business owner. |

`scripts/generate-api.mjs` parses local YAML, rejects duplicate keys/remote references and uses Redocly to lint/bundle
the description. Its installed CLI children disable optional telemetry/update checks; actual lint/bundle failures
remain fatal and tool/compiler versions are unchanged. openapi-typescript emits declarations without runtime enums.
Strict Ajv 2020 plus ajv-formats
compiles standalone validators and their required runtime helpers. Feature chunks load their own validators;
neither the browser nor server startup compiles schemas. openapi-fetch consumes the generated paths while
`app/transport.ts` supplies headers, runtime validation, cancellation and status classification, retaining the Response.
Types alone cannot validate received JSON. Do not introduce another schema language, validator configuration or router.

For local generated-input rejection, `app/transport.ts`'s `generatedInputError` projects safe rule metadata onto
feature-supplied visible field/row/day labels. `InvalidInputError` carries that typed diagnostic to the existing
command/feedback owner; shared feedback translates it at render time and retains the same dismissal receipt across
locale changes. Read validator errors immediately, since generated validators reuse them. Never expose raw validator
messages, paths or submitted values, copy schema limits into another validator, dispatch a rejected write or discard
its mounted inputs/files. Task-specific messages, such as Survey's minimum choice, can retain their catalog keys.

After all current outputs are written successfully, generation removes only recognized obsolete direct browser
validator modules/declarations carrying its exact generated banner. Cleanup anchors to the selected output root's
real directory, rejects redirected browser directories beneath it before publication and preserves current case-only
filename aliases, links, foreign files and subdirectories.
`--check` reports obsolete artifacts without writing or deleting files. Generated runtime artifacts remain separate
from temporary test/review output; removing a retired validator does not change current schemas or validation rules.

Use explicit scalars, object properties/required, arrays, local references, enums/const, bounds/patterns and simple
tagged `oneOf` unions. JSON null uses a type union rather than OpenAPI 3.0 `nullable`. Mutation bodies reject unknown
fields; browser response validation accepts compatible additions while error parameters retain their authored shape.
Separate create/update/read semantics and permitted projections. Avoid recursive polymorphism, arbitrary maps,
deep `allOf`, remote references and custom executable vocabulary; `readOnly`/`writeOnly` cannot enforce disclosure.
These shape preferences require author/reviewer judgment, not generator bans on arrays, objects or unions.
Compare scalar meanings with the original accepted contract and its explicit amendments before copying native
payloads or a consolidated design summary. Numeric record identifiers use declared positive decimal strings;
counts, capacities and reviewed revisions retain their own numeric contracts. Shared domain engines can keep
numeric internal IDs behind one existing argument adapter. The
[finance wire correction](decisions/DEC-006-FRONTEND-FRAMEWORK.md#approved-finance-wire-correction-2026-10-20)
records why accepted precision and wire spelling are separate decisions; do not silently relabel an unimplemented
accepted choice as future work or change business validation to make a transport schema convenient.
Strict Ajv validation still rejects unknown schema vocabulary. Do not disable strictness or enable coercion,
default insertion or additional-field removal. Timezone existence and cross-field business checks remain named
controller operations.

Two implemented constraints preserve existing field behavior. Registration/reset author
`x-surveyor-min-length-utf16: 8`, because native password validation counts UTF-16 units; ordinary JSON Schema string
bounds count code points, and passwords acquire no maximum. Existing-item capacity admits the number/string/null
primitive union and passes the raw scalar to the existing signed nullable SQL column. Database rounding/range/failure
remain authoritative; creation/new-item validation stays separate. Do not generalize either extension into coercion
or a copied database-limit policy.

The current HTTP adapter decodes single scalar path/query/header values, JSON and entity/Finance multipart, and
delivers JSON or scoped binary image/proof responses. Creation decodes the `data` JSON part once against its authored nested schema
and handles `image` separately. Repeated query parameters, absent/empty values and malformed input stay distinct.
On the server, `receiveApiUpload`, `decodeApiMultipartData`, `decodeApiMultipartImage` and `sendStoredApiBinary`
in the existing transport owner share matching upload completion, multipart decoding and confined binary delivery.
All five entity adapters and Finance's proof adapter use the matching owners. Features still select their parser, byte/type/filename limits, generated
operation, authorized storage root, method admission, cleanup and controller; transport performs no domain write.
The browser's `createMultipartForm` in the existing transport owner supplies matching creation, header and invoice
proof envelopes. Packing, Drivers, Event, Survey and Activity retain its default `image` part; Finance participant
and organizer submissions explicitly select `proof`. Features validate generated input, require or allow absent
files, and select their operation. The serializer only encodes an optional `data` part and appends the original
optional file under the selected part name. Header operations pass no metadata. It neither chooses an endpoint
nor changes headers, comparison evidence, proof policy or file lifetime.
The maintainer's [2026-10-15 correction](decisions/DEC-006-FRONTEND-FRAMEWORK.md#maintainer-correction-2026-10-15)
clarifies that removal of unused implementation did not authorize definition restrictions. Parameter schemas may
use arrays, objects and unions; response definitions may declare media such as `text/plain`. Generating their
contracts, metadata and validators does not restore repeated-query-array decoding or plain-text response delivery.
Validate actual standalone consumers and compile-time null/false/optional/tagged cases rather than handwritten copies
of the wire contract.

Use each operation's declared status/media rather than the native envelope. Handle `204`/`304` before JSON parsing;
HTML `200` or invalid delivery cannot confirm a command. RFC 9457 Problems keep code/status/messageKey/parameters
correlated, with safe localized detail and bounded field pointers. Unknown future errors may display validated detail
without triggering known machine actions. Credential rejection, field denial and foreign-child absence retain their
operation-specific meaning. Private localized representations carry `Content-Language`, applicable `Vary` and
`private, no-store`; cache headers never authorize data or expose validators, SQL, session or filesystem details.

For a released API version, additive response fields and optional operations can remain compatible. Removing or
renaming fields, changing their type/meaning, adding mandatory input or changing an existing operation's authorization
or outcome is breaking: obtain an explicit version/migration decision and retain the supported released contract
until consumer retirement is authorized.

#### Adding or changing a feature view

Inspect all current consumers of a repeated new-frontend interaction. Share meaningful overlap in its logical owner
and adopt that owner in every matching current consumer in the same change; a future migration is no reason to defer
existing duplication. Distinct feature behavior stays explicit, and an imagined future caller does not justify an
unused abstraction or a general CRUD engine. Shared backend/domain/catalog ownership remains separate and unchanged.

Matching creation/property text fields compose `FormField`, including its textarea variant; pass each existing label,
icon, constraints, rows, autocomplete choice and required-marker policy explicitly. An omitted native field name uses
`name=null`, distinct from the default name derived from its ID. `FileField` composes the same label/control owner and the existing file
release composable; the feature retains its selected File and command/draft decisions. Rejected or unknown commands
keep that exact input mounted. Do not copy a chooser merely because its caller creates rather than edits an entity.
Read-only Packing/Drivers/Survey/Event/Activity descriptions use `EntityDescription` for escaped lines. Lists retain their
paragraph hook, spacing and optional divider; Event supplies an unnamed ordinary paragraph inside its own labeled
column. The shared owner does not add wrappers or copy a feature's draft. Survey ballot and result labels share the
answer appearance mapping while retaining their different wording.
`FormField` keeps Vue's native input directive by default for composition/caret behavior and deliberately normalized
numeric consumers. A numeric field with a lexical string draft explicitly opts into `lexicalNumber`: its controlled
value and input event preserve the entered spelling through change, blur and a sibling render. Emitting a DOM string
from the default number setter alone does not prevent Vue's separate change-time normalization. Matching lexical
finance, Event capacity, Activity and creation controls adopt this shared option rather than copy raw inputs.
The shared attribute owner supplies names, constraints, disabled/read-only state, classes, accessibility labels and
explicit data hooks to the textarea, ordinary input and lexical-number input. Its input-only adapter adds type,
minimum, maximum and step. Optional `inputMode`, `groupClass` and the append slot retain numeric hints and
calculation actions without a second field model. Feature owners still select constraints and normalize only at
their deliberate submission/comparison boundary; numeric Quick Add retains its separate intentional coercion.
Use the control slot when a field needs a distinct picker or DOM lifecycle, retaining the feature's actual node,
constraints and focus target. Standalone fields and Activity's initial text/time/number controls require visible
localized labels; a placeholder is inadequate. Repeated table fields can take their visible context from column
headings while retaining an explicit accessible association for each control, including the shared field's
visually hidden label where that preserves the established row layout. Do not duplicate a visible label in every
cell merely because the same control also serves standalone forms.
When a form disables its focused field during submission, pass that form's actual initiating `pending` to
`FormField`. This input only joins the shared focus lifetime; it changes no disabling, model, native validation,
normalization or secret-clearing policy. Creation and metadata wrappers forward the same pending state through
their field slots. Native number/date controls that retain distinct Vue directives explicitly bind the scoped
`#control="{controlRef}"` input with `:ref="controlRef"`; the field never discovers descendants or adopts a component
proxy. Readonly inputs that can still initiate Enter submission use the same form pending state.

`InlineCell` checks `KeyboardEvent.isComposing` before preventing Enter's default action or committing input;
the multiline shortcut retains Ctrl+Enter. Activity's role input uses the same ordering before its own select/create
action. Composing Enter belongs to the browser; a later ordinary shortcut, mouse action and blur retain their
existing behavior. Keep these guards in the actual shared inline and distinct role owners. This approved composition
behavior supersedes the historical native reference.

Matching Bootstrap command/filter buttons use `ActionButton` with their
existing variant, size, form and disabled policy. Pass the initiating operation's actual `state` or `pending` even
when its native presentation has no spinner; `:show-spinner="false"` keeps that existing appearance independently of
pending disabling, accessibility and focus handling. Broader blocking conditions remain separate `disabled`
inputs. A sibling command's lock must not masquerade as this control's initiating work or claim its focus.
Preserve an existing query-read progress indicator where its original contract uses one. When a local marker
identifies a different initiating control, its siblings remain blocked without borrowing that pending state.
An existing specialized button appearance, such as Activity's list-group role suggestions, uses `unstyled` with
its caller-owned classes. This omits only the default Bootstrap button classes; the same actual button retains
initialization, disabling, accessibility and focus ownership. A styling difference alone does not justify a
second action implementation or a native-control exception.

Pending spans the complete initiating action, including every selected fresh read. An ordinary
`command.reconcileSafely` does not itself set `command.recovering`; its protected recovery branch does.
Use the existing read/command state when it covers that lifetime. When one handler awaits several independently
settling reads, its owner may retain a presentation-only initiating marker through `finally`, as Overview, Event and
Finance do. This marker selects the control or row; it stores no request, snapshot, draft, permission or command
lease. Matching Save/Cancel, ballot/combination and repeated-row actions likewise identify their actual initiator
while siblings retain their separate blocking policy.
If one selected read fails before another settles, `refetchFreshQueries` waits for all already-dispatched reads
before propagating the first observed failure. Failure must not release the initiating control while a sibling
request still belongs to that action.
When one inspection reconciles independent command histories through a shared GET, start with the uncertain
owner so its protected recovery spans that read. Other histories consume the same completion; every affected
owner still participates in repeat-action and dismissal admission.
The shared Event picker distinguishes Previous, Next and Retry from filter/background discovery. Creation keeps
Create pending across its admission/write handoff while a read-only admission Retry only blocks Create. Profile
workflow authority Refresh likewise stays distinct from token/destructive commands; submission remains blocked
until its complete protected authority read finishes, including after session verification has already completed.

`usePendingFocus` is the one transient focus owner for `ActionButton`, `FormField`, `InlineCell` and distinct native
controls such as the locale select, Packing Everyone switch and Activity role-entry input. Callers supply their
actual control reference, initiating pending state and existing availability. Native disabling remains unchanged.
If that disabling releases its existing focus, completion restores only the same mounted, available control with
no scroll movement, while focus remains unclaimed. Effective native disabling includes an enclosing fieldset.
Any deliberate pointer/key action, another focused control, window blur, actor retirement or unmount cancels
restoration. A command started elsewhere never claims focus. The control owns only this transient DOM reference;
operation admission, drafts, requests and results remain with their existing owners.
An inline editor's ordinary blur save has no focused initiating input; a successful editor removal owns no
replacement focus. Main identity submission, recovery mail, guest registration and profile switching likewise
retain distinct initiating state even when one command blocks their sibling controls.
The pending observer runs before its own component render: capture precedes native disabling, and completion's
`nextTick` waits for the queued enabling patch. A synchronous observer can schedule restoration before that patch;
an action that starts and finishes in one render turn needs no restoration because no disabled state is painted.

Built-browser checks retain their actual cold-read and cache conditions: additional locale cycles must not prime
an article before its first-load assertions. Position the actual target in a horizontally scrollable surface before
measuring complete visibility, and settle fixture movement before sampling geometry. When a deliberate focus move
only establishes the target for a later no-scroll assertion, `focus({preventScroll: true})` separates that choice
from unfinished native focus scrolling. Keep genuine response delivery and the original node, focus, scroll,
availability and persistence assertions; fixture setup does not justify weaker checks or longer deadlines.

Durable feature warnings use `StatusNotice`,
with feature-owned content, visibility and warning intent rather than a new timer or command owner.
Its default live-region role follows the feedback kind. Pass an explicit null role only for an existing plain notice
whose contract has no live-region announcement, rather than silently adding accessibility behavior during composition.

`AppTabList` shares the native tab keyboard contract and Reka roving tab stops across Settings and Activity. Its default
presentation is pills; Activity supplies the tabs variant, IDs and panel targets. Arrow keys, Home and End activate
and wrap without scrolling, including modified keys. PageUp/PageDown retain browser behavior rather than Reka's extra
activation. Pages own admission and keep their dirty panels mounted; do not bind a broader command lock to Activity's
otherwise enabled tabs. A page's selected key must remain among its current admitted tabs. Reevaluate that selection
when fresh data removes the selected panel: Activity returns to Schedule when the selected Participants panel
becomes empty or the selected Rules panel loses admission, without switching back merely because that panel later
returns. Keep an admitted panel's dirty controls mounted and preserve independently available panels; the tab
primitive cannot infer feature eligibility.
Shared assignee lists likewise retain admitted names and removable IDs; feature-specific
remove controls may use the existing list's slot without copying list markup or changing server authority.
`AppAccordionButton` shares matching expanded/collapsed trigger presentation and initialized activation across Event,
Overview and administrator disclosures. Features retain which panel is open, panel markup, contents and reads; pass
their existing disabled condition and control target. A visual trigger never owns query admission or a draft.

Judge interface parity by the information, actions and steps users experience. Explicit requirements and approved
changes are exceptions by default: integrated Refresh, complete localization, usable responsive layout and common
non-jumping SPA notifications supersede incompatible native details. Native IDs, field names used only by an old
document POST, exact margins and copied overflow are not contracts. Keep meaningful label/control associations,
keyboard order, value parsing, focus return, disclosure state and reviewed inputs; do not weaken these to simplify
a test. Shared styles own locale-neutral wrapping, while feature tables retain intentional horizontal scrolling.
The shared Vue `table-responsive` viewport also provides a positioning boundary for clipped absolute controls;
their offscreen boxes must stay inside that scroll owner. Keep complete columns and real label/keyboard activation,
and verify document width and actual window movement before and after local table scrolling. Hiding overflow on
the whole page would conceal the defect rather than preserve usable content.
Reuse the module's current admitted read for Refresh and preserve dirty values, server cooldowns and actor/resource
fences. A page-level Refresh covers every currently admitted data region unless that region has its own healthy
Refresh control. Keep that deliberate user read separate from narrow post-command dependencies: select the existing
eligible observers with the captured actor, resource and intent, without resetting their drafts or creating another
read owner. Workflow Refresh rechecks authority without reissuing tokens or replaying private preview commands.

Activity creation supplies its title/date row and initial dated slots to `EntityListCreation`; that shared owner
retains admission, root drafts, files, Event selection, permissions and confirmed navigation. Optional submit wording,
layout and resource parameter inputs preserve existing Packing/Drivers defaults. `InlineCell` supplies Activity's
non-table and multiline editors through explicit presentation inputs; its existing draft/conflict/save owner remains
shared with list cells. Activity owns warning-review intent and cancellation separately from the shared command owner;
the server's current preview and exact overlap acknowledgement remain authoritative. Participant progress is read-only
in the basic Activity workflow, and printable schedules retain their authorized document destination.
Settings receive optional linked-Event/archive hints and export links through the existing settings/lifecycle owners;
defaults preserve other consumers. `FormField` accepts an explicit label target separately from its input ID/name
when the visible label targets a separate actual control, such as a timezone button. Neither presentation inputs nor client guards grant method
authority. The Activity Slots badge counts every admitted saved slot; All/My/Open only change visibility, and an
empty collection displays zero. Derive the total from that collection rather than DOM rows or another store.

Under the approved calendar-day policy, `src/common/lib/civilDate.ts` is the pure shared owner of strict ISO civil
date parsing, selected-locale display and Monday-to-Sunday week grouping. Activity creation adapts its clipped day
arrays, and the versioned detail projection returns its structural `CivilDateWeek` values without another calendar
loop. UTC calendar stepping preserves saved days across timezone and daylight-saving changes, including a preceding
Monday in year 0999 for an admitted year-1000 plan. Event and Activity date-only presentation use this same owner;
feature adapters retain their existing invalid/absent fallbacks. Stored dates, domain calculations and printable
output retain their existing owners.

For advanced Activity, compose `ActivityRequirements` and `ActivityRecommendations` inside the admitted Rules tab;
changing tabs preserves their independent drafts. Requirements keep lexical form values and the saved calculation
context separate from refreshed snapshots. Initialize the independent requirement draft from an already admitted
cached configuration when the form mounts; a fresh or unchanged refetch need not replace its cache object. Preserve
dirty values on subsequent reads. `requirements.ts` calls the existing pure requirements engine for local
coverage and baseline calculation, and `ActivityParticipants` renders both saved and unsaved progress. Structural
engine inputs and the shared `RoundingMode` declaration under `src/types/` keep ORM entity imports out of browser
compilation; this type boundary changes no calculation or database behavior. Role and override identifiers stay
positive decimal strings in generated contracts and drafts. The same `requirementAnalysisInput` argument adapter
in this existing helper serves both Analyze and Calculate, converting to the unchanged pure engine's numeric IDs;
returned browser progress restores string IDs. Do not copy the engine, convert IDs in each component or change its
native/domain declarations merely to match a transport representation.
Authored fallback names require explicit provenance before a presentation owner replaces missing raw text. Activity's
versioned callers opt into optional name-origin fields from the existing shared controller reads; other callers
keep their established payloads. `activityParticipantName` translates only identified fallbacks or locally identified
absent names, never English-looking user text. Matching saved/live progress, search, override labels/sorting and
manual/staged recommendations adopt that helper. A staged row retains origin in its local declaration, while the
review serializer excludes both names and origin. Locale changes update presentation without rewriting those rows.
The form emits only its current mode for native-equivalent Auto control; it remains the sole requirement draft and
generation still uses saved server settings. Slot-role and manual recommendation editors retain valid selections
while clearing fields and IDs released by fresh admitted options. Dictionary keys from role titles remain data.

Recommendations keep their local rows, manual modal and frozen application batch in feature owners. Shared
command/query admission, warning presentation and dialogs retain their existing lifetimes. Entry, explicit Reload,
explicit generation completion and confirmed application deliberately reuse existing controller maintenance; never place that
operation in Query, background refresh, retry or ordinary job-status reads. Pure recovery reads do not prove that an
uncertain dispatch failed. Poll only a confirmed job identity and stop on terminal, retired or denied context.
The approved automatic deadline-job observation also consumes an identity returned by entry. Its completion reads
saved proposals through a pure snapshot; only an explicitly dispatched generation retains the maintenance trigger.
New local swaps also retain their explicit partner relationship in the existing feature draft. Review/removal
operations use that identity, not the first row moving between reciprocal slots: multiple participants can make
independent moves across the same two slots. Saved rows have no local creation provenance. Infer a reciprocal
counterpart only when both directions are unique; otherwise require explicit selection before changing
review state. Cancel preserves all rows. Harmless fresh snapshots, renamed labels and locale changes preserve the
captured choice. Revalidate the relevant operations and their saved review versions; a changed or retired reviewed
operation releases the chooser, and a changed or retired candidate clears its selection before confirmation.
Actor/admission retirement releases the chooser. Never include local pair metadata in preview/application
serialization. If a known partner is removed or replaced, release both former legs as explicit single moves
instead of guessing a replacement partner.
Generated rows and known independent local moves remain separate. This review relationship supplies no new server
application guarantee.
Submit the identical previewed batch with its current overlap acknowledgement; existing server engines retain
authority over generated/manual provenance, swap-leg blocking and applied/skipped decisions. Keep job diagnostics
private and pass only explicit permitted scalar projections. Inherited postcommit regeneration failures remain
outside this adaptation.

Finance composes the admitted Event page without adding a finance page/router or another HTTP owner.
`FinanceSection` keeps audience-specific reads, disclosure and selected participant/organizer review intent;
`FinanceSubmission` owns its lexical invoice draft and exact proof File. `FinancePoolEditor` shares matching
creation/settings fields, `FinanceOrganizerInvoice` keeps its independent optional proof and paid-by draft, and
`FinanceInvoiceReview` freezes the original invoice/action/revision through explicit retroactive confirmation.
Enrollment/factors/exemptions, signed adjustments and coverage belong to `FinanceAssignments`, `FinanceAdjustments`
and `FinanceTakeovers`. Each retains its own draft/save boundary: a sibling save or adjustment removal must not
submit, reset or replace another unfinished form. History, saved totals, share ledger, coverage groups and lazy
breakdown compose feature presentation and existing shared controls. Matching ledger footers share one owner.
`FinanceEnrollmentFields` presents the three matching creation/assignment flags with explicit IDs, names, labels,
help slots and update events. Both callers adopt it while retaining their own drafts and independent saves. The
default flag attaches future registrations independently of assign-all/current membership; never force one flag
when another changes. Creation's All toggle selects every current attendee. The assignment editor instead restores
its remembered individual selections when All is cleared.

Use the existing invoice controller/operations and saved financial presenters; never calculate a replacement share
in a component or turn a saved read into preview, settlement or recalculation. Interface wording is an explicit
per-call formatter with unchanged English defaults for existing native outputs. English `invoiceMessages`
references select text/plurals from the existing invoice catalog; locale generation resolves and hashes that
static source rather than maintaining copied English prose. The ordered development watcher observes this source
and publishes readiness before Express restarts. German translations retain the same validated message contracts.
Localized finance cache families
retire together on audience denial, retaining the producing observer's explicit recovery control. A language-only
read transition retains the same cache-owned snapshot and mounted draft through pending/transient failure, with
commands disabled until a fresh current-language receipt. The retained Query's disabled observation prevents
ordinary cache expiry from releasing an unfinished invoice; denial, eviction and actor/resource retirement still
release it. No copied server snapshot or second draft owner is introduced.

Finance's `numbers.ts` owns the shared wheel guard for number inputs in participant submissions, organizer expenses,
invoice review, factors and signed adjustments. Each form installs it explicitly while keeping lexical strings,
constraints and deliberate submit-time encoding in its feature owner. Matching fields use `FormField`'s explicit
`lexicalNumber` option. `financeDecimal` in that same feature helper expands exponent and leading-zero input spelling
with character operations before sending plain decimal strings; it retains meaningful precision and never changes
the mounted draft. Saved money comes from the existing shared `formatInvoiceMoney` presenter, factors use canonical
four-place strings, and numeric invoice/share identifiers use the generated positive-decimal declaration. Clean
read-derived factor and correction fields use that same encoding helper without fixed padding to retain their
former visible numeric spelling; transport padding never normalizes an already mounted dirty draft. Existing
controller operations retain their Joi normalization and business validation; no parallel decoder or browser
financial arithmetic is introduced. Changing these wire shapes uses the existing compatibility family and
update-required recovery so older loaded clients cannot submit incompatible commands; mounted draft guards remain.
The guard releases the focused numeric control before
native wheel stepping without changing its value. Filtered factor rows stay mounted; validity reporting reveals an
invalid row before focusing it. The assignment editor preserves deliberate individual selections and disabled local values;
only selected assignments contribute factors/exemptions to the submitted body. A released eligible target must
remain visibly represented or be deliberately cleared, rather than silently diverge from submitted draft identity.
Trace validation through the generated adapter and shared operation: optional NEW-invoice acceptance does not
inherit the stricter precision checks of a required retroactive correction merely because both render numeric fields.

Keep current coverage inputs distinct from saved applied coverage. The shared chooser fixes participant mode to the
current registration and eligible OPEN pools; organizers retain their independent payer/reassignment grant. Its
current/pending row shortcut selects the intended payer without turning a read-only applied CLOSED group into an
edit. Saving closed-pool allocation inputs marks the existing recalculation state and leaves saved shares,
recorded transfers and applied coverage intact. Components never rebuild those figures from their draft.
`FrontendTransport.uploadJson` adds transfer progress to the existing generated response/actor checks. Upload completion
is distinct from save confirmation. Unknown delivery locks the draft until deliberate saved-history inspection and
human acknowledgement; it never replays automatically. The same explicit saved-list review protects additive
adjustments. Submission access, assignments, coverage and adjustment removal reconcile through fresh reads.
Confirmed save releases only completed fields/proof bytes, retains the applicable pool and remains saved when
the following read fails. Settings, assignments and coverage retain a form-owned saved-field baseline through
Close/reopen and explicit discard; never restore older Query values over a confirmed submission. A fresh admitted
roster reconciles stable identities while retaining surviving lexical factors and adding new participant defaults.
If a confirmed coverage save lacks a fresh read, changing payer first uses protected recovery; failure retains the
visible payer and selection. Do not maintain a parallel coverage/reassignment model to infer other payers' inputs.
Versioned JSON and
multipart adapters prepare acknowledgements before entering the existing EventPool controller operation; page,
method, participant and proof admission remain separate. Original backend normalization, revision checks and
notifications remain shared without a new backend remedy or generalized comparison protocol. Native proof/download
outputs keep their explicit destinations. `FinanceCalculationReview` reads a fresh saved-input preview and
captures its revision for close/recalculate. Its feature `drafts.ts` coordinates the existing settings, assignment
and adjustment predicates without copying their values or widening the native guard. A background read cannot
replace reviewed values; every apply attempt consumes confirmation authority until explicit Refresh preview.
`FinanceSettlement` captures the signed saved payer row and confirms the existing status command without adding
a revision field. `FinanceShares` retains display identities while showing fresh confirmed amounts/statuses;
Refresh list or a control change reapplies deferred filters/order. Its read-only mode also presents actual saved
rows during unknown-calculation inspection without exposing inert breakdown or settlement actions.
`FinancePoolOutputs` keeps rollback and later saved-email delivery as separate deliberate intents. Rollback
preserves shares/transfers and reports whether external changes still require calculation; email counts identify
eligible queued recipients rather than successful external delivery. Calculation, settlement, rollback and email
commands use the existing no-replay owner and explicit unknown-result review. Both PDF variants remain ordinary
authorized downloads of the complete saved ledger, independent of browser filters.

1. **Identify its actual contract.** Trace the original accepted decision and all applicable dated amendments through
   their actual callers before treating a requirement as unresolved. Carry existing authorization into the handoff;
   a generic restatement or reused request identifier does not reopen a resolved choice. Follow page admission,
   request parsing, controller decisions, DBAL and rendered
   controls. Include owner, guest and restricted actors; coercion; omission/null/false; no-op outcomes; destinations;
   feedback; focus; and hidden/empty/archived states. Peer features are evidence to inspect, not a universal policy.
   Classify every form and link, including shell, parent/context and destructive controls: ordinary migrated
   command/navigation, initial or external capability arrival, provider handoff or output/download.
   Inspect actual targets and side effects; an old anchor, token-related name or partial backend
   failure does not independently make an ordinary Vue workflow a document boundary.

2. **Expose the smallest useful projection.** Author the operation/schema once in its v1 YAML. Reuse the owning
   controller projection and method permission definition; do not serialize entities, sessions, permission internals
   or hidden edit data. Keep contextual validation/errors in the controller. Read/page admission and independently
   granted action admission stay distinct. Transport adapters may preserve different envelopes or coercion without
   copying business decisions.

3. **Connect the scoped browser operation.** Use generated declarations/validators and the app-local transport.
   Capture identity/resource/route scope and pass the same AbortSignal through HTTP decoding, classification and
   cooldown owners. Query keys contain actor/resource/meaningful filters; locale belongs only to translated content.
   Shared keys/families name dependencies without teaching generic owners a feature.

4. **Wire entry, routing and SSR before editing.** Extend explicit Express/Vue routes rather than a wildcard HTML
   fallback. Use Router for ordinary admitted migrated destinations, including warm entry and shell/context links;
   preserve modified clicks and meaningful hrefs. Preserve true provider, external token/email arrival, print and
   download boundaries rather than treating every token-related internal action as document navigation. Entry preflights use `usePageEntry`
   where the journey has an admission decision; public read-only views can use a direct query. Request-local SSR
   renders the same Vue tree without self-HTTP. Initial seeds check live document/scope eligibility when evaluated;
   Back, eviction or actor change cannot replay retired SSR data. Use `requiresClientInitialization` and existing
   route metadata for initial content; shared controls use `useClientInitialization`. Cover shell controls as well
   as the feature body so JavaScript failure cannot leave a normal-looking action which cannot work.
   Preserve the native document title separately from a visible heading. Use catalog-owned complete journey titles
   with the existing `usePageTitle` owner where prefixes or branding differ, and verify initial/warm/locale updates.
   Derive resource guest/admin/detail intent from the router's admitted canonical records through
   `resourceRouteIntent`; a visitor's case or trailing slash must not select another operation. Express registrations
   likewise capture their declared mode explicitly. Preserve original parameters, query and fragments rather than
   lowercasing complete return URLs. Public Home and the authenticated personal Dashboard retain distinct admission.
   Help's declared route metadata identifies its article readiness and locale-URL owner; an unmatched descendant has
   no Help readiness provider and must not wait for one.
   `navigatePageEntry` binds its lazy delivery to the captured actor and actual Router attempt. Identity retirement
   cancels that obsolete attempt before commitment, while a later deliberate visit to the same URL remains independent.
   Do not turn a temporarily absent authoritative session into an anonymous redirect or a private-read grant.
   `EntityEntryPage` owns cancellation/removal for a feature's explicit `deniedQueries` selection. Features return
   affected families and any inactive-only copies; they do not repeat eviction dispatch. Preserve the producing
   admission family when removing inactive visits: a paused observer can be inactive to Query while still owning
   the visible denial. Do not clear a live independent creation draft or infer families from tuple positions.

5. **Complete read/recovery behavior.** Start queries only when identity, hydration, visibility and activity permit.
   Retire obsolete generations and preserve server cooldowns. Missing pending data uses shared skeletons; temporary
   failure retains confirmed scoped data/drafts and its stale notice. Validated denial clears private content.
   Explicit Retry is an eligible read which observes its actual deadline and last successful receipt. A canceled
   observer refetch may fulfill with retained data; fresh authority requires a new admitted read.

   Separate initial reads for counts from recurring disclosure polling. Closing a region pauses its polling while
   retaining admitted snapshots and drafts; it does not revoke access. Show an unknown count until its source is
   admitted. After a confirmed write, require the owning fresh read and refresh only eligible active dependent
   observers. An absent optional dependent observer is not a failed owning read; a selected dependent read failure
   still needs stale feedback. Keep that selection in the shared query owner rather than copying cache rules.
   Bind binary-image recovery to successful query receipts, including equal-version background reads; watching
   only changed data cannot restore an image after a validated terminal response.

   Use the existing context-owned `useActionState` for an operation's live eligibility, pending and blocked inputs.
   Pass that state to `ActionButton`, select spinner presentation independently and keep unrelated blocking in its
   disabled policy. A distinct native control receives only its applicable disabled/pending refs. Call `isAvailable()`
   before dispatch. The control and handler must share this decision, including session revalidation and cooldowns;
   an enabled-looking action must not silently stop at an undisclosed read gate. `usePageEntry` and `useCommand`
   expose their own action states so callers reuse their lifecycle decisions. Keep read admission
   in the read owner: session recovery must remain available while ordinary reads wait, local Cancel/draft controls
   need no read admission, and already admitted commands retain their captured completion lifetime. This derived
   state stores no drafts, server data or authority and never retries an operation automatically.
   Compound recovery uses the existing retry availability of every required session/resource read through
   `useCommand`'s `recoveryEligible`; it must still be able to establish ordinary read admission after a failed
   session check. A retained warm admission failure adds its warning without replacing the admitted form nodes.
   Reevaluate already-open dialogs when method grants change: readable content and local drafts may remain, while
   dispatch controls must show the same current availability as their handlers.
   Activity's shared-text form preserves its opening title/instructions field set: losing one grant blocks
   partial submission until that grant returns or the user leaves the draft. Other owners retain their existing
   field-review contract; `MetadataDraft` can deliberately release unavailable fields through its explicit Review.
   Read-only dialogs retain selection, not copied server values. Event notes resolve the selected participant or
   whole-roster summary from current admitted data even when local search hides its row. A removed row or empty
   summary retires that selection; genuine date drafts remain independent.

6. **Add independent drafts and commands.** Use the existing draft/command owners with feature normalization and
   operation-specific feedback. Original, local and remote values stay separate. Current-value comparisons check
   touched fields under locks; financial/recommendation commands retain their separate revisions/reviews. Submit
   deliberate changes. Confirmation acknowledges submitted values; only a fresh read supplies current grants/token
   and baseline. Failed refresh remains saved with stale authority. Unknown delivery never automatically replays.
   Independently granted writes need independently granted baseline reads: filter values and comparison hashes by
   the actual method policy rather than require broader detail admission or a token obtained before revocation.
   Tokens for context-bearing or authenticated scopes retain their existing profile or frontend-context binding.
   A public scope without identity or frontend context binds resource, method and visible fields/current values;
   current grants are rechecked.

7. **Compose presentation through shared contracts.** Reuse fields, inline editors, dialogs/tabs, action buttons,
   permission matrix, pickers, skeletons, notices and images where behavior is shared. A feature supplies values,
   capabilities, events and operations; controls own visual/accessibility interaction. Preserve meaningful labels,
   constraints, no-op behavior, ordering, disclosure and focus; keep spacing and responsive layout usable. Keep feature composites separate
   where their semantics differ.

8. **Verify the changed boundary.** Apply [risk and test cost](TESTING_GUIDE.md#risk-and-test-cost), preserve unique
   assertions and inspect actual consumers of shared corrections. Check compiler scope honestly and test the
   affected mounted controls/reads/commands. Use equivalent records, actors and sizes for visual checks. Obtain an
   independent semantic review and report actual commands, failures and limits. A build, helper test or screenshot
   alone cannot establish feature completeness.

   Choose risk-relevant cases with multiple independent records and changing selection or permission eligibility.
   Assert exactly which records and controls change and which remain, rather than counts alone. Derive expectations
   from the original contract and approved exceptions; native agreement cannot establish that a copied defect is
   intended. A regression for a known defect must distinguish its broken behavior from the intended result.

   For an ordinary migrated form/link, extend its existing built-application E2E with a document marker and
   observation of main-frame navigation requests, then assert the generated request, visible result and persisted
   effect. Exercise warm entry and completion, rejected input, canceled departure, pending/unknown no-replay and
   failed follow-up navigation/read where the change crosses those boundaries. Explicitly exercise allowed
   provider/capability/output transitions separately. A final URL or successful database write alone cannot prove
   SPA delivery; synthetic documents cannot supply application E2E evidence. This is contribution review and
   existing application coverage, not a new infrastructure scanner, test framework or CI gate.

   Compare every affected visible control's wording, value/state, constraints, painted hierarchy and usable fit,
   including surrounding form actions and common footer where relevant. Assert recorded browser errors and
   meaningful layout/interaction contracts; retain raw geometry for inspection rather than prescribing native pixels.
   Collecting JSON or screenshots alone does not protect the result. Separate explicitly required additions and approved shell
   differences from the compared component instead of weakening assertions until they pass. Record the actual
   database version and SQL mode before interpreting persistence-dependent outcomes; preserve the shared business
   behavior and diagnose environment differences without introducing validation solely to satisfy a local fixture.
   Exercise actual click and keyboard targets too: wrapping descriptive checkbox text in a label changes activation
   even when the resulting screenshots are identical. Keep fixture focus equal, then compare focused states explicitly.

   Compare current captures with the recorded last native originals; the retired renderer is not a live test fixture.
   Characterize incidental computed-style differences before changing an assertion. In recorded Actions evidence,
   the native button sat inside a form which was a flex item; the Vue button is itself a flex item, so the browser
   blockifies its computed display. Inspect wording, availability, focus, painted hierarchy and reachable fit without
   turning that incidental computed value into a DOM contract. Keep raw diagnostics, semantic links/actions,
   destinations and command-effect assertions; a layout improvement does not authorize silently dropping controls.

Readable source is part of every step. Keep template controls and render branches in logical groups with purposeful
blank lines, explain inputs and non-obvious lifecycle steps, and prefer named operations to nested anonymous flows.
A syntax-clean checker result does not establish useful comments, actual reuse or human-readable formatting.

When coordination changes, enumerate every active writer and actual lock order, including self/admin removal,
item deletion, relationship changes and foreign-key locks. A comment claiming a shared lock is not scheduling
evidence. Use controlled milestones in the real disposable-database operation path to distinguish source inference,
reproduced failure and verified remedy. Do not generalize one feature's locking or harmless no-op policy to another.
Authorization still precedes an unchanged relationship outcome; reviewed comparison is needed when the relationship
changes. Resolve potentially unintended access or concurrency changes directly before dependent implementation.

#### Worked extension: one metadata field

Adding an editable field follows one coherent path:

1. Inspect its input policy and owner/restricted behavior. Decide whether the wire contract actually changes; reuse
   a generated field if it already exists.
2. Update the owning YAML request/projection once and generate consumers. Keep sparse omission versus explicit
   clearing, including null/false/empty.
3. Extend the named shared controller policy/projection and field permission definition. A contextual check against
   current locked state belongs in its controller callback inside the existing DBAL transaction.
4. Add catalog messages and bind the shared field in the feature editor. Supply normalization to `MetadataDraft`
   only when the field needs it; dirty comparison and submission use the same meaning.
5. Run the existing named command and fresh-authority continuation. Test unrelated remote changes, overlap, denial
   and confirmed-save/failed-read where those distinct risks cross the changed boundary.
6. Check the actual mounted control, its submitted value and its release/retention behavior; update affected Help
   and canonical guidance when the visible contract changes.

A read-only view stops before editor/command work but still owns admission, privacy, cancellation, retry,
localization and visual behavior. No universal CRUD engine or wrapper per HTML element is needed.

#### Worked composition: Event, Packing, Drivers, Surveys and Activity

The implemented consumers illustrate the ownership handoff without another controller or state store:

| Feature supplies | Shared owner actually adopted |
|---|---|
| Exact entry operation and actor/resource-dependent denial families | `EntityEntryPage` presents admission and dispatches scoped retirement through `app/queryCache.ts`. |
| Title/icon, permitted parent URL, image operation/version/detail key and current settings state | `EntityHeader` renders the shared title/image/parent actions and composes the existing authorized-image lifetime. |
| Generated settings/metadata operations, query keys, field grants and controls; complete access operations where applicable | `EntitySettingsDialog` and `EntityMetadataEditor` retain independent drafts and command boundaries; Packing/Event/Drivers/Activity additionally adopt `EntityAccessEditor`, while standalone Surveys supply no Access operations. |
| Current mounted metadata editor and field normalization | `useMetadataEditorHandle` exposes the same public workflow; nullable text uses `normalizeNullableMetadataText` in `metadataDraft.ts`. |
| Root or captured Event-child operation, current capability, native wording and refresh dependencies | `createEntityLifecycle` shares archive/restore and pause/resume behavior through the caller's existing command. |

Event keeps schedule/capacity rules, registration and actual date drafts in their feature owners. Packing keeps item
commands and its browser-local checklist. Drivers keeps ride/passenger semantics. Surveys keep personal ballots,
collaborative recurring choices and representation-only comparison tokens; their owner settings add neither Access
nor event association. Activity retains its slot/role/requirement/recommendation workflows. Packing, Drivers and Activity
inject their event-association operations; Event has no parent association editor.
Shared presentation neither constructs endpoints
nor grants authority; matching current consumers adopt the shared owner together while feature differences remain explicit.

#### Worked composition: Packing and Drivers

`EntityListCreation` owns their matching admitted root form, file lifetime and creation command. Packing supplies
its row controls and collector; Drivers supplies no initial rides. `BasicEntityMetadataFields` shares their basic
title/description editor, also adopted by standalone Survey settings, while the existing Packing field adapter
retains its public feature contract.
`useListDetail` shares scoped polling, stale-projection closure and fresh recovery; features select the denied-query
families to retire. `useListReorder` captures one
gesture's membership and comparison evidence. `EntityQuickAdd` shares the matching card, description, capacity and
submit presentation through `FormField` and `ActionButton`. Packing supplies its editable required title; Drivers
supplies its readonly actor name. Features retain the values, collectors, commands and reset/uncertainty decisions.
The capacity control keeps installed Vue's native number directive, its coercion and DOM update lifecycle, including
leading-zero normalization on change or rerender. The draft retains a number or remaining input text; substituting
a string round trip would change that behavior. Description and capacity
retain their native omitted names. Explicit hint styling preserves each feature's existing appearance.

`EntityListCounters` presents the admitted Packing/Drivers counts and feature labels without calculating membership
or capacity. `RefreshButton` places their existing read action beside settings in `EntityHeader`, while the inline-edit
hint stays inside the `table-responsive` parent. Survey and Activity adopt the same heading action, outside their
data-only branches so cold recoverable failures retain manual Refresh. Existing read actions own pending state
and server cooldowns; Activity's validated denial retires Refresh, while list/Survey deliberate read recovery keeps
its existing eligibility. `PageHeading`
keeps entity and profile titles centered despite unequal parent/action widths. These presentation owners choose
no reads and do not change scroll ownership.

`EntityAssignees` and `EntityAssignmentActions` share names/removal
and feature-supplied assignment/full wording. Each feature supplies its own operations, query families, grants and feedback.
Drivers displays the offering profile as driver and counts only passenger assignments; Packing alone has Everyone
and browser-local Packed? state. Shared controls never infer those feature rules.

`useListCommands` in the existing `listDetail.ts` owner supplies matching Packing/Drivers/Survey/Activity command/read recovery.
Each feature injects its active/denied/read state, actual fresh read and dirty policy. The shared composition owns
cooldown/action state, guarded post-command reads, explicit reconciliation/stale feedback and acknowledged review of
an uncertain creation; no recovery repeats a mutation. Survey supplies its existing ballot merge after a fresh read. Packing and
Drivers additionally select `listProblemKey` for their common permission wording; Survey retains its own Problem
presentation. Its `denyInlineEdit` supplies Packing/Drivers' shared transient notification without creating
an operation, status lease or HTTP request. These are shared lifetimes, not another query/draft store or feature policy.

Deliberate UI retries use `command.reconcileSafely`; a failed read returns false. Query retains diagnostics and
cooldown. Command success normally publishes its saved notice; an explicit `success: null` preserves a native
operation that completes quietly, as with recommendation entry, Reload and the maintenance reads following
generation/application. Select silence before publication rather than briefly manufacturing a saved result.
All transient notices use the shared non-jumping page/dialog presentation; none focuses or scrolls its caller.
This input changes no confirmation, uncertainty, protection or failure handling. Other operations retain their
actual progress/results and default success where meaningful.
Feature drafts and unknown-command status stay with their existing owners. Causal post-command reads retain their rejecting contract so confirmed
save plus failed refresh remains distinguishable. `useSettingsAccessRetirement` in the same list-detail owner shares
editor-family cancellation/removal and actor/resource/lifetime fences across all five detail Settings consumers.
Each feature closes its dialog and injects its families and fresh read, retaining Survey's ballot merge and Event's
independent projections. Event entry and detail denial use one `eventDeniedQueries` selection in its existing read
owner: a method denial releases only its affected intent, while missing-root absence invalidates associated families.

`EntityDetailReadState` shares the denied, stale/cold warning and missing-pending-data skeleton fragment across
Packing, Drivers, Survey and Activity. Features pass the actual denied/error/data/pending state, timestamps, cooldown and route
shape. Lists retain their `list.data`-based successful timestamp; Survey retains its displayed-data timestamp.
Its optional slot accepts contextual recovery; heading Refresh retains its separate feature-owned eligibility.
The component never infers admission, replaces a retained draft or owns a query, receipt or retry timer. Common
presentation does not authorize normalizing distinct existing timestamps or changing a table's scroll ownership.

#### Backend and method-policy contracts

The [controller/DBAL rules](#controllers-and-services) apply to every transport. Central method permission definitions
live in the existing controller. Adapters can decode/coerce differently, return different envelopes or apply their
declared preconditions; capacity, ownership, deletion and access policy remain one shared business implementation.
Page membership must not silently narrow a separately granted action, and edit-token projections stay private.
Controller method admission, v1 adapters and capability projections must consume the same method definition;
matching duplicated permission literals are still separate owners. Preserve operation-specific native no-op outcomes and
deadline ordering when adapting commands instead of adding an apparently helpful precondition in the v1 adapter.

Event's controller shares `eventCapacityReached` between presentation and registration admission, including
the distinction between no limit and a stored zero. `mayReadEventChildren` shares attendance/assignment-management
eligibility between related projections and child lifecycle rechecks. Their callers supply existing counts,
rows and locked context; DBAL remains queries/transactions/persistence, with no new concurrency guarantee.

The Event roster GET, organizer attendance PATCH/DELETE and registration-link list/revoke operations declare optional
session authentication because their existing method grants can be public. Those five OpenAPI declarations describe
the unchanged route/controller admission. Link creation retains its account requirement; detail, own attendance and
lifecycle retain their profile requirements. Optional authentication never bypasses origin/context checks or the
server's independently evaluated method grant.

Treat every browser-supplied identity, profile, context, security token and capability value as untrusted input.
The session admission owner reconstructs identity from the server's stored session and loaded relations; context
and CSRF comparisons check submitted claims against that server evidence. Existing controllers decide current
ownership, grants and business policy. Browser capability flags, query keys, epochs and disabled controls guide
presentation only; they never select the acting identity or grant permission on the server. Preserve this boundary
when adding an adapter instead of trusting a previously displayed projection.

`req.session` is the one middleware-managed request Session. `captureApiActor` checks stored identity/generation
without replacing it, rejects a mismatch and hydrates a plain server-only actor. It neither initializes missing
metadata nor clears invalid authority on admission. Ordinary controller/provider/feedback consumers keep the same
Session and library save methods; do not introduce a second writable snapshot or a generic persistence lifecycle.
The separately approved identity transaction alone stages isolated completion and adopts its committed receipt.

For a fresh anonymous visitor, initial session projection and public SSR without feedback leave the Session
unpersisted and issue no cookie. A view without frontend identity scope carries null context/CSRF.

An account-required document redirect intentionally saves the existing native anonymous Session to carry its
one-time notice. Preserve the login/return destination and consume the known notice through the native flash library;
do not replace it with a URL parameter or initialize context/CSRF just to carry feedback. That anonymous feedback
Session can still have null frontend metadata. Whole-application session/flash unification remains separately scoped.

Complete stored pairs remain unchanged. Authenticated legacy records use read-only domain-separated HMAC metadata
bound to server secret, SID, principal/profile and partial context, never browser-selected identity.
Explicit identity transitions persist the existing random pair. Keep compatibility derivation in its owning session
helper; do not copy it into adapters, client code or another authentication owner.

Context headers are conditionally required by server state. A context-bearing or authenticated scope cannot omit
its evidence to become public. Mutations in a public scope without identity or frontend context require affirmative
configured-origin/Fetch Metadata checks, a valid non-simple compatibility header and their generated
JSON/multipart/no-body contract. Controllers independently
authenticate personal actions and reevaluate public grants. Public comparison baselines bind resource/operation,
visible field set and current values without inventing a shared anonymous identity; tokens do not authorize writes.

The existing flash getter creates an object even for absent messages. Document reads inspect existing
nonempty channels before consuming them through that library, avoiding accidental first-visit persistence. Real
feedback still uses ordinary Session/save ownership. Complete required business continuations before fallible
feedback delivery; retain their original outcome and bounded operational logging if delivery fails. Native TTL,
actual flash consumption, expiry/logout and token/provider entry effects retain their existing scoped behavior.
No general flash merger, save observer, admission transaction or global session concurrency guarantee is introduced.

Packing supplies a concrete ownership example. `packingMethodPermissions` owns requirements consumed by the
controller's method checks and capability projections used by its v1 adapters; root property fields reuse the existing administration field policy.
`savePackingMetadata`, `addPackingItem`, `applyPackingItemPatch` and `applyPackingMembership` own the corresponding
writes/checks. Reorder/remove/default operations accept the existing service-managed transaction when an adapter
coordinates several writes. `eventController.authorizeEventLink` checks the locked destination;
`entityAdminController.applyEntityAdministrator` returns domain outcomes for each adapter's response mapping.
These are owning operations, not forwarding wrappers or business rules in DBAL. Another feature follows its own
policy/contracts rather than copying Packing's grants or persistence shapes.

`entityAdminController.entityMethodPermission` supplies common header, event-link, permission-management and
duplication requirements. Feature controller method maps, property/capability projections, header operations and
event-link checks consume this owner. Keep actor/profile admission and feature exceptions alongside their
established consumers; a shared grant does not imply a shared page-admission rule. Follow the definition to every
actual consumer, including header preflight/write, duplicate entry, administrators and relinking. Retained output
routes use their existing explicit permission middleware. Shared operations do not by themselves remove a copied
permission literal; adapters consume the owning controller policy and DBAL must not choose the grant.

Conditional-header limits are authored contract constraints, including the full token emitted by metadata/settings
reads. Reuse generated schema/operation validation through the existing transport and comparison owner. A decoder's
safety bound must agree with the wire shape rather than reject the application's own issued token. Verify generated
input/output consumers with a realistic full token and an oversized rejected token.

Packing's method-specific reads illustrate independent action admission:

| Admission boundary | Current Packing scope |
|---|---|
| Server context when present; optional profile; fresh method grant | Item edit/order/delete and minimal baselines; administrator assignment removal; default/admin CRUD and scoped baselines; account-profile discovery; header baseline/preflight/write; description-only GET/PATCH. |
| Active profile and existing operation policy | Full detail, metadata, settings and header bytes; mixed metadata writes, creation/Quick Add, self-assignment, archive/restore, event changes and owner deletion. |
| Existing entry policy | Session/Help and create/resource/duplicate entries retain their own admission; duplicate GET does not grant account-only creation. |

Public baselines carry only the method's values/hashes. Tokens retain their existing profile or frontend-context
binding where present; public scopes without identity or frontend context bind resource, method and visible
fields/current values. Mutations apply server-context/CSRF checks or the public origin/header protections above as
appropriate; conditional comparisons and authorization before `304` apply to both scopes.
Header admission runs before upload bytes and again under the write lock. Scoped account-profile discovery uses
the existing 120-search/10-minute per-IP limiter; the adapter owns its localized Problem presentation. Do not
generalize this matrix to another feature or expose a full settings page merely to obtain one edit token.
Packing's item/order, defaults, single-admin, header and description baselines omit unrelated fields, assignments,
rosters and parent metadata. A displayed or disabled control is never server authority. Inherited permissions,
owner, guest, archival, personal visibility and permanent deletion remain distinct concepts.

Keep a short operation account in its contract/test evidence: decoding, actor/page/action grants, normalization,
no-op outcomes, lock/check location, response/feedback and destinations. Inspect deliberate differences rather than
turn peer behavior into policy. General defects and unrelated backend behavior changes follow the
[separate-work boundary](policies/DEVELOPMENT_POLICY.md#scope-of-separately-authorized-work); a contract or backlog
entry does not authorize their implementation. Reusing an existing business operation does not make its recorded
defects a prerequisite for a presentation/transport adaptation. Apply new-code security and delivery requirements
without claiming stronger legacy guarantees or introducing another postcommit rejection.

#### Entry, canonical delivery and outcomes

`observePageNavigation` owns repeated router subscription, pending-destination retirement and disposal. App, Header,
Overview and page-entry/confirmed-transition consumers adopt it with their existing all/document/path boundary and
callbacks. Features still decide admission, feedback and focus; the observer keeps no server data or navigation
authority. Preserve the newest destination when an older lazy delivery settles and dispose each caller's subscription.

Keep server-owned admission/canonical navigation separate from temporary resource reads. `usePageEntry` owns the
entry decision. Capture the intended destination/notice once and commit it through the shared confirmed-navigation
owner. Failed or canceled delivery retains the same completion through component remounts within its captured actor
scope, without replaying a command. A navigation Retry repeats only its required reads and destination delivery.

Permanent deletion uses `useEntityRemoval` in Settings, Overview and Event Things to do. Its action derives
availability from the existing shared confirmed-navigation receipt and its own command admission. All three
consumers use that same action for their Delete control and dispatch: another pending or retained receipt pauses
only permanent deletion, without taking ownership of sibling drafts or other writes.
After confirmation, the delivery owner synchronously installs its receipt before yielding to cancellation of
older Overview reads and invalidation of the captured actor's collection variants through the shared query-cache
owner. That first invalidation runs even when shared read admission or a server cooldown prevents a GET; no
unprotected handoff leaves a second deletion available. Later Retry repeats required reads/delivery without
repeating invalidation or DELETE. The receipt retains selected family keys, never a feature callback, another
data/error snapshot or separate write-lock state. It refreshes eligible mounted collection readers before delivery;
inactive/hidden variants stay stale for their own next admitted read. It never reads the deleted detail. The exact current URL
and a warm different destination both require this delivery boundary: a duplicate Router replacement is not a
fresh read. Failed reads retain confirmed success and admitted reads/delivery recovery, with the actual eligible query
failures supplying Retry availability/deadlines through the existing cache and read-retry owners.
Temporary shared read suspension keeps dependency Retry closed without consuming the receipt; session-refresh
recovery remains able to restore its own admission. Actor replacement retires the captured continuation.

Preserve exact duplicate return through the shared guest-flow owner/forms and surveys' distinct policy. Invalid
guest tokens and expired stored identity keep their established status, message and provider boundaries. Read retries
cannot consume a reset/activation/guest capability or submit a creation. A configuration-denied login/register
journey uses its full error presentation rather than an empty form. Confirmed recovery/guest registration uses its
canonical destination; inline success on the old form is not equivalent. Pending/unknown states retain input and
explicit review.

Packing, Event, Drivers, Survey and Activity use the same `features/identity/GuestEntryPage.vue` for the name/email draft, advisory existing-email
choice, confirmed identity completion and uncertain-delivery recovery. Each entry supplies its bounded title read,
guest-registration operation, query key and exact destination. Event retains `regToken` through identity navigation;
only a deliberate registration command spends that capability. `EntityEntryPage.vue` shares resource admission
presentation and recovery while feature entry owners retain read intent and denial invalidation.

Event creation and duplication follow the same ordinary SPA command/navigation contract as Packing. Generated
reads supply bounded creation/duplicate context without creating an Event; the deliberate generated multipart
command uses existing native preprocessing, image assignment, creation and default-permission initialization in
their existing order. Preserve raw optional capacity, audience masks, shared permission initialization and duplicate
exclusions rather than inferring new rules from the transport. `useCreationCommand` in `src/frontend/composables/creation.ts`
is adopted by Event creation and the shared `EntityListCreation` used by Packing, Drivers and Activity. Survey creation also
composes that owner with its standalone recurring-choice draft and no event/audience inputs. It composes the existing
command, feedback and confirmed-navigation owners. Event and Survey own their fields/File; the shared list form owns each
mounted feature's root fields/File, and Packing retains its collection draft and collector. Rejection or uncertainty
retains submitted values and the chosen File. Confirmation marks creation submitted, disables replay and retains the canonical destination through failed
navigation. Feature fields and the chosen File release on accepted route/actor retirement or unmount, rather than
being cleared while that confirmed form still awaits destination delivery. Existing multi-step creation can
partially complete: do not promise atomic creation, rollback or automatic replay.

Common landing/message/error presentation consumes explicit request-local data through the existing bootstrap codec.
Validate scalar shapes without coercion; retain a captured landing suggestion through SSR/hydration. Known plain
message keys translate in place; literal details remain escaped, and stacks follow server-owned development admission.
Route query data cannot create outcomes or diagnostics. Reused feedback retains its original completion lifetime
through locale changes. Optional complete-title and Home-destination inputs preserve existing consumer defaults.

Fragments and modified-click hrefs preserve ordinary navigation semantics. Region navigation reads the target before
history commit, merges only its region into current query state and adopts server-clamped pages/parent removal.
Failure or obsolete response leaves the URL/cards/focus intact. Search draft/caret and sibling regions survive.

#### Commands, drafts and retained work

TanStack Query owns authorized snapshots, feature drafts own original/local/current values and Router owns URL
state. `MetadataDraft` applies feature normalization consistently to dirtiness and sparse submission; omission,
null/false/empty remain distinct. No-op validation/feedback precedes confirmation, cross-form discard and writes
where the workflow requires it. Machine/raw number drafts survive framework coercion: inline capacity acceptance,
creation bounds and SQL persistence are different policies.

`EntityMetadataEditor` formats Original/Mine/Current values once for matching feature consumers. Display booleans
with the shared localized Yes/No catalog keys and preserve numeric zero; reserve the empty placeholder for null,
undefined or empty text. Presentation never changes draft normalization, comparison evidence or submitted values.
Exercise the actual feature's review/recovery controls so a false setting cannot appear absent behind a passing
standalone formatting assertion.

Use application-root draft protection with feature/dialog subtrees. Dialog close resolves its own work; route,
identity/update and whole-page destructive departures resolve every affected descendant. Pending/unknown command
state may outlive an editor; retiring a component does not certify delivery.

Admit a new `useCommand.run` only while its owning component remains mounted. Reject a retained callback after
unmount before capturing actor scope, retaining a status lease or invoking the operation. Retained
completion state protects an admitted command; it cannot grant another submission from a retired owner. Preserve
legitimate deferrals: a child chooser can close while its command owner stays mounted, and an operation admitted
before unmount can defer its request or finish settlement, follow-up reads and confirmed navigation under its
captured scope. Do not substitute cancellation of in-flight work or treat every dialog close as owner retirement.

Obtain whole-page deletion consent before writing. Retain confirmed deletion/creation destination and its one-time
receipt through failed navigation. `useEntityRemoval` releases its original discard approval when the first delivery
attempt settles. A later Retry or other departure uses the existing root guard's current draft state, so an earlier
approved draft can ask again and a new sibling draft remains protected. The confirmed result and receipt for required
reads/navigation remain separate; recovery never repeats DELETE. Do not discard other drafts because a button
was hidden or capability changed.
Field write loss disables saving while readable drafts remain cancelable; actor/read denial retires protected state.
Confirmation acknowledges submitted values; only a fresh admitted read restores grants/token and baseline.
A saved command followed by failed refresh remains saved with stale authority, not a failed mutation.
This includes a follow-up read suppressed during same-actor session revalidation: return the confirmed write result
so the feature releases completed input, and retain the failed-refresh warning. Read admission and captured-command
identity are separate. An obsolete read error alone cannot erase confirmation; actual actor retirement still does.

Unknown outcomes are reviewed through reads without automatic replay. Reconciliation cannot prove that an unknown
creation failed; preserve submitted input and require deliberate review or acknowledged departure. Financial and
recommendation commands retain their specific revision/fingerprint protocol rather than a generic comparison rule.

Ordinary migrated mutations use generated JSON/multipart commands and shared Vue command/navigation owners even
when the inherited backend operation can partially complete. Transport adaptation preserves existing controller
ownership, operation order and truthful known/unknown outcomes; it does not authorize a stronger transaction or
excluded backend repair. Prepare fallible bounded reply material before invoking an inherited mutation where
possible, and do not add a later mutable-context rejection of its confirmed result. A lost or ambiguous result
requires deliberate review, never automatic replay or speculative rollback.

Profile token issuance is an explicit user command, not a refreshable read. Never issue or replace a capability
through query refresh, prefetch, remount or Back/Forward. True document/external capability entry retains its admitted
compatibility behavior. Read-only preview and deliberate transfer use generated body contracts; keep secrets and
private results in admitted mounted feature state, outside URLs, query caches and persistent storage. A fixed
nonsecret fragment may support local history without replay. Capability denial is a presentation outcome, not loss
of the viewing identity. Warm internal entry must obtain bounded admission without requiring a document refresh.

Transfer, profile deactivation and account/guest deletion reuse existing native controller operations and sequencing
through the SPA adapter. Shared command and destructive-navigation owners retain confirmation, pending/unknown
guards and appropriate submitted input. Preserve native wrong-confirmation validation and `ExpectedError` meanings,
including inherited partial failures; a server error after a possible write is not proof of rollback. Confirmed
internal completion uses Router; a true external provider logout destination remains an explicit handoff. The existing
controller branches expose typed completion facts, including conditional former-user/guest cleanup. The existing
`migrateProfile`/`deactivateProfile` facts overloads share those branches and `ProfileOwnerCleanup`; default native
callers retain their current wording. `profileWorkflowCompletion` projects the generated notice, and
`ProfileWorkflowPage` carries the shared catalog message key through the existing
notice owner, so language changes translate an already visible notice. Never parse English prose or repeat a cleanup
decision in the adapter/component. Newly authored interface and validation text uses the shared catalog. Retire
unused document-only Vue adapters after actual consumers move, while retaining explicit compatibility entries.

Guest registration, API account signup and activation use the existing user controller's `commitIdentityCompletion`
through `UserService.withIdentitySessionTransaction`. The controller owns expiry/context checks, staged identity and
result preparation; pure DBAL owns the manager, row lock and persistence. Prepare required projections and serialized
replies before final commit through the existing session/transport owners. API envelopes cross generated validators;
admission GET completion prepares its notice/redirect. A precommit session check followed by a separate session save
leaves a partial mutation and does not satisfy this boundary.
Project an identity-changing completion from its actual staged context/CSRF fields. Read-only legacy compatibility must not
supply replacement values which conceal malformed newly prepared output; validation failure still rolls back the
operation and leaves the original request Session untouched.
An actor-preserving confirmation instead retains its admitted context, including a derived legacy context. Use the
existing prepared-response default rather than overriding it with partial raw stored metadata.

Use `registerGuestWithSession` for Guest/profile plus stored identity, `registerUserWithSession` for inactive
User/profile/activation token, and `activateAccountWithSession` for token consumption. API account signup preserves
the current actor and never returns its activation token; document activation stages redirect/flash in the token
transaction. Adopt only the completed detached receipt, without a response-time session read/write which can
substitute another tab's actor or reject an already committed operation.

After registration commits, SMTP selects an already prepared delivery outcome. Guest email failure remains advisory
feedback with the confirmed personal link; account failure uses its completion surface and keeps activation required.
SMTP acceptance does not guarantee inbox delivery. Never recreate identity, replay registration or treat network
uncertainty as rollback evidence. Keep database/session schedules and client adoption/retirement assertions separate
from helper-only evidence. Do not generalize this operation boundary to every session/provider workflow.

Login, private guest-link login and profile switching use `loginUserWithSession`, `loginGuestWithSession` and
`changeActiveProfileWithSession` with the same completion owner. `prepareIdentityReply` finishes the API projection
before locked identity save commits; delivery adopts the prepared receipt outside rejection handling. Private
guest-link GET prepares its notice/302 under that owner. Credential, profile ownership and return-path decisions
remain shared. An inactive account's activation resend belongs before the identity transaction: its refreshed
token must survive intended login rejection. Provider logout keeps its separate operation boundary.

Profile administration uses `getIdentityProfile` for account/guest fields and `getIdentityProfiles` for the account-only
roster. The original frontend implementation wrapped field editing and additional-profile creation in the identity
completion transaction. The maintainer's A2 correction (2026-10-14) restores direct reuse of `updateProfile` and
`createProfile`, with their native persistence/session-save behavior. Prepare the simple generated `MutationResult`
before invoking either operation; deliver it without another context read, projection or save. This does not extend
registration/login/profile-switch atomicity to ordinary profile fields. Shared confirmed navigation refreshes session
display after acknowledgement and retains read/navigation-only Retry. Retire old profile/roster snapshots before
adopting fresh settings; display failure never rejects, repeats or reopens the confirmed write.

Explicit API logout uses `logoutUserWithSession` only when `session.tokens` is not truthy; an empty object still
selects the protected provider path. Recheck that classification on locked staging before clearing authority.
Prepare the generated anonymous API receipt in the transaction, then adopt the detached completion without another
session save. The mounted caller owns its admitted navigation; token-bearing provider paths retain their own order.

Password reset uses `resetPasswordWithSession` to check the token under its account lock and prepare the API receipt
through `prepareValidatedJson` before password/token mutation commits. `sendPreparedJson` delivers the captured
receipt without another session write. Serialization failure leaves original token/password state intact. The
token-admission GET remains distinct from mutation. A lock protects only its cooperating writers; inspect all active
operation paths before claiming a broader atomicity guarantee.

Reset-mail uses `requestPasswordResetWithSession` with shared username-first account resolution. Prepare token,
private link/templates, cached sender and generic API result in the same transaction. Cached sender setup makes no
SMTP connection; captured delivery follows commit through the existing mail owner. Keep known/unknown accounts'
generic confirmation and established errors, without account-found/delivery metadata. Forgot-mail and inactive-login
resend keep their own operation boundaries. No later session read/write may reinterpret the completed operation.

Shared relink/archive/restore owners accept typed `EntityMutationCompletion` preparation inside their existing locked
transaction. Packing relink evaluates resulting view admission through the manager-aware owner, including unchanged
and unlink outcomes; archive/restore prepare their invariant acknowledgement without an unused later archive DTO.
Omitted completion retains each existing caller's default presentation. Do not copy lifecycle business checks into
an adapter or treat every static typed response as another database projection.

Personal visibility uses the user controller's optional typed completion and manager-aware archive projection. The
Overview adapter maps visibility, archived and overviewHidden once under the lock, then its route uses
`prepareValidatedJson`/`sendPreparedJson`. Membership/private preference and shared archival stay separate. Callers
which omit the completion retain their presentation; they do not acquire another frontend's response protocol.

#### Read authority and recovery

Packing's checklist uses its established browser-local keys, separate from query snapshots and server assignments.
When browser storage is unavailable or throws, preserve checks only for the mounted actor/list visit. Show a
persistent localized load/save-failure notice explaining possible loss of unsaved changes on leave/reload or
account/profile change. Failed reads cannot establish that previously stored or successfully written checks are
unpersisted. Successful rereads observe external changes; a real missing key is unchecked unless a failed toggle
write still owns the item's selected value. Explicit Retry reattempts outstanding browser-storage writes and reads
only; keep the notice while reads fail or writes remain outstanding. Background reads never replay writes.

Before a retained local callback writes, check its mounted actor, admitted current list and live/rendered row.
Retry prunes removed rows before retrying. Dispose fallback and pending writes on list/context change, unmount or
admitted-resource retirement. Preserve profile-independent persisted keys and keep this state outside the server.

Authorized cache data is presentation, not perpetual command permission. Controller admission rechecks every write.
Identity/profile/resource/route generations retire reads, caches and tokens; late responses cannot repopulate them.
Language-independent machine state uses one authority across languages. Locale-owned Help/Overview projections have
their own locale keys; a prior-language grant cannot restore revoked edit authority.

Overview derives its current key's actual `Query.state.isInvalidated` through `useQueryInvalidation`, in the existing
query-cache owner. While that flag is set, `OverviewRegion` and `OverviewCard` block archive, restore, automation,
personal visibility and Delete at both control and handler boundaries. Keep this write fence separate from existing
navigation, search/filter, paging, expansion and Refresh admission; retained cards remain readable. A warm destination
or reopened collection cannot authorize writes merely because it has cached data or navigation has already
completed. Ordinary failed background reads and locale invalidation also pause these writes while their current Query
remains invalidated; this accepted tradeoff can last through a prolonged read failure. Use that cache state directly,
with key changes and subscription disposal, rather than another freshness flag, deleted-ID registry or data store.

Presentation readiness and automatic-read admission are separate. Focus, visibility and reconnect recovery require
a current successful session bootstrap before private queries resume. A pending, failed or cooldown-blocked bootstrap
cannot reopen those queries. Retain mounted readable data/drafts during ordinary revalidation; validated identity
change retires the old actor. Apply admission to every automatic query consumer, not only explicit refetch.
The context's `readsReady`/`mayRead` contract supplies this gate; `ready`/`isCurrent` retain their presentation and
result-generation responsibilities. Automatic consumers use `useQueryAdmission` in the existing query-cache owner.
It applies `mayObserve(key, firstRead)` per mounted logical-key visit: a fresh visit gets its own GET despite cached
terminal failure, while a dispatched or joined pending read consumes first admission. Recreating an equal key does
not start another visit. Later session resumes keep terminal failures paused. Deliberate manual recovery uses
`mayRead` within its read deadline.

Shared transport also checks dispatch admission. An already admitted image/picker operation keeps its captured
lifetime during ordinary bootstrap pause; actual actor/input/visibility retirement still disposes it.
Explicit command-dependency refresh uses each observer's key-bound `surveyorRead` metadata, rechecking current
eligibility/disposal after cancellation. A terminal-paused readable observer can recover through its own authored
query function; hidden, closed, retired and changed-key observers cannot. Do not select query-level last-writer
options or create a parallel query-policy registry.

Forward the same AbortSignal through decoding and classification. A fulfilled TanStack observer refetch can contain
canceled retained data; fresh continuation uses `refetchFreshQuery`/`refetchFreshQueries` in the query-cache owner.
Await the actually dispatched admitted read, retaining command/authority fences until it settles. Equal successful
data can restore authority; object identity, timestamps and idle flags alone cannot. Temporary errors retain
confirmed readable data and raw drafts with their last successful scoped receipt. Validated denial retires private
projections/entry variants; only another admitted read restores them, not cache aliases or stale SSR seeds.
Review readable-data loss separately from write loss.

Retire derived membership totals, hidden badges and related counts with the projection supplying them. A denied
region must not leave private aggregates after its cards/cache disappear. Derive presentation from admitted source
scopes/receipts through the existing feature owner; do not mirror server counts in a second store. Temporary failure
retains confirmed scoped evidence; independently admitted siblings retain only their own evidence. Unknown membership
has no zero/count/empty assertion.

Healthy active shared queries use the 30-second cadence and eligible recovery within roughly one minute. Honor
Retry-After, hidden-tab pause and observer disposal. Safe reads may retry; commands do not. Use shared `useReadRetry`
and `useReadRetryAt` with notice controls for eligible GETs. The deadline timer changes availability; it never starts
a GET or renews unrelated feedback.

#### Bootstrap, hydration and scoped completion

Each SSR request owns its app, router, QueryClient, translator and authorized bootstrap. Escape script delimiters in
bootstrap JSON. Do not serialize persistence/session/private edit data through convenience objects. Request/locale
state cannot live in a singleton. When adding a bootstrap field, update its declaration contract and the exhaustive
field-validator map in `app/serializeBootstrap.ts`. Validate the complete wire object before reactive state;
generated lazy feature validators remain schema owners rather than duplicate renderer/page checks.
`decodeBootstrap` owns exhaustive browser validation. `serializeBootstrap` only serializes/escapes inert JSON;
successful SSR serialization is not proof that every bootstrap field was validated for the browser.

The context helper derives initialization needs from route metadata and admitted denial/completion evidence; the
shell uses `context.hydrated` and `LoadingSkeleton`. Do not copy route classification or add another control/read
readiness policy. `initializeFrontendApp` stages initial feature mounting through `initialContentReady` inside bounded
Vue error capture. That internal step admits neither actions nor scoped reads. Initialization succeeds only after
mounting and first readiness render; captured failure restores `context.hydrated` to false while retaining partial
draft/command owners. Readable denials/completions and Help GET search, article links and anchors stay functional
static content before JavaScript runs.

Shared initialization also gates JavaScript-only shell selectors, actions, Retry and dismiss controls. Genuine links
and mobile navigation disclosures remain reachable. The renderer's independent localized failure notice works before
the entry executes, including disabled, missing, blocked or failed initialization. A normal-looking control must not
depend on an uninitialized client. Initial setup/mount/first-readiness failure cannot leave the app marked initialized.
If a failed attempt attached handlers, genuine static links and Help GET search still navigate through their HTML
owners, retaining edited-control consent. This bounded initial boundary does not replace later feature-error owners.

Shared mount preserves genuine static pre-hydration drafts, such as Help search, on original controls. Explicitly
opted-in non-text/file controls use `data-hydration-draft` where admitted. Recovery uploads no files and submits no
commands. Interactive initial inputs are skeletons; mounted feature drafts keep their own protection. An SSR seed
is eligible only for its live document/actor at use time, not because a captured closure once matched.

Startup protection precedes asynchronous route loading and mounted router guards. Retain edited static controls
through failed initial chunks/bootstrap; keep the initial guard until mount restoration finishes. Automatic departure
needs demonstrably clean state and a working loop marker; unavailable storage leaves visible localized recovery.
Deliberate recovery can bypass the automatic-attempt marker but still confirms edited-control loss and respects
pending/unknown command protection. Reuse startup, mount and update owners; never persist secrets/files or replay
commands to recover startup.

Automatic full-document reload additionally requires an explicitly eligible dynamic route and dynamic admitted
content. Overview, Packing/Drivers/Survey/Activity detail and Event detail/admin opt in. Creation, duplication, user-management and
Help remain excluded even when pristine. Static admitted errors/completions on a dynamic URL remain excluded through the existing shared
content classifier, rather than a copied list of bootstrap fields. `usePageEntry` registers its live static predicate
and document visit with the context; registration captures the actor/epoch and retires on unmount, identity change or
disposal. The context owns no second query payload. A visible denial stays static after initial-data retirement;
fresh render admission restores dynamic content. App, SSR and update recovery consume that same classifier.
Declare this policy in route metadata and supply
its live value to the existing update coordinator so release observation, missing chunks and command settlement
share one decision, including after route changes. Draft/command/initialization/loop guards still apply. Excluded
pages retain update notices and deliberate recovery. Periodic content reads and session/security revalidation are
separate contracts and remain unchanged by this full-document policy.

SSR parent aggregates use the same admitted QueryClient projections as child regions. Seed only the eligible initial
document before parent badges render. Page/Region share `overviewQueryParameters` from the existing Overview API
owner, so generated query keys identify the same data. An old seed or manual cache write never becomes fresh
post-command authority.

Express serves shared static/Help resources; Vite transforms entry/style URLs before inserting the Vue tree.
Keep cascade composition in authored `styles/application.sass`, consumed by both the client entry and development
renderer. It orders Bootstrap Icons CSS, base `style.sass`, `help.sass` and `frontend.css` once; do not maintain
another list in a caller.
Its source link and built-manifest delivery remain usable before JavaScript, including static Help. `style.sass`
retains its accordion/timezone graph and installed Bootstrap layer. Import Bootstrap Icons CSS and its font files
through this authored build graph too. Application-owned browser assets use the instance's origin through existing
Vite development delivery and Express built-asset delivery; do not add CDN stylesheet, script or font dependencies.
This follows the [approved 2026-10-26 amendment](decisions/DEC-006-FRONTEND-FRAMEWORK.md#approved-local-browser-assets-and-responsiveness-scope-2026-10-26),
which supersedes the earlier requirement to preserve both CDN and compiled Bootstrap layers.
Built documents preload the entry's manifest-declared shared modules. The client build also prepares Brotli/gzip
sidecars for emitted JavaScript, CSS and SVG; the public asset owner negotiates available encodings with
`Vary: Accept-Encoding`, retaining original files and their byte-range delivery. Development warms the shared
source entry, stylesheet and SSR entry through Vite. Installed startup loads the same built SSR module before HTTP
readiness without creating a request or private state; production never imports Vite or compresses files per request.
Test emitted URLs and mounted usable controls, not a hydration marker. HMR/authored-input restart checks are relevant
when their owners change; they are not required again for every unrelated feature view.

#### Responsiveness targets and evidence

Optimize toward first visible draw and population of the initially visible skeleton regions within one second
from navigation start. The maintainer's 2026-10-26 clarification makes this an internal optimization target,
not a production delivery requirement or an automated one-second test gate.

Production uses the established Core Web Vitals good targets: Largest Contentful Paint (LCP) at most 2.5 seconds,
Interaction to Next Paint (INP) at most 200 milliseconds and Cumulative Layout Shift (CLS) at most 0.1, each at the
75th percentile of page views, assessed separately for mobile and desktop. These follow the
[official Web Vitals guidance](https://web.dev/articles/vitals).

Measure first draw/FCP, hydration and actual visible content population separately; a hydration marker or a
decorative skeleton does not establish usable feature readiness. Record the route, data, cache state, CPU/network
conditions and any synthetic responses with lab results. Lab measurements guide optimization; production compliance
requires representative field measurements and cannot be certified by a local fixture or a small sample of runs.

#### Progressive loading and shared placeholders

Initial interactive HTML is the shared skeleton until client initialization, separate from authoritative session
admission and independently pending feature projections. Once initialized, Overview active regions load in parallel;
unopened hidden regions wait. Readable Help retains complete SSR and functional GET search/links. Resource data
arrives through its owning scoped query without renderer self-HTTP.

Use `LoadingSkeleton` for client initialization and missing pending data. Declare the page-family shape once in
`createApp.ts` route metadata, using the shared `.d.ts` presentation contract; scoped callers reuse that declaration.
The renderer composes common fields, tables, cards and lists. Initial/admission placeholders include their page
frame; a scoped body must not duplicate an already rendered header or card. Distinct major regions such as Packing's
initial-items table and login's recovery section compose the same primitives rather than copying whole templates.
Shapes are decorative, with one localized status and one animation per loading region; they invent no records,
membership count or command. Respect reduced motion and actual responsive geometry. Packing/Drivers keep all table
columns with horizontal clipping; the participant roster alone follows its existing compact email-column behavior.
Never replace readable same-resource content/drafts on ordinary background reads or show a false empty state.
Independent siblings render when ready. Initial failure has clear error/Retry; unknown membership has no zero count.
Identity/resource transitions cannot retain another scope's content. Same-resource locale refresh retains user
values/machine state while labels react. Article content matches its selected corpus or visibly disclosed complete
English fallback, with actual content language identified.

#### Shared presentation, feedback and images

Shared controls have explicit data/capability/value/event contracts. Generic controls cannot import feature API
owners or choose private query families; inject operations and let the feature name affected resources. Keep feature
validation and financial semantics outside generic form/inline/action components. Native controls, semantic tables,
Bootstrap-compatible geometry and suitable Reka dialog/tab primitives remain the shared presentation strategy.

Extract a settings composite only when repeated interaction shares its data, events and injected operations.
`EntitySettingsDialog` owns Packing, Event, Drivers, Survey and Activity's matching settings reads, independent panel/file drafts, close locks,
refresh and command composition. `EntityMetadataEditor` owns their shared original/local/current reconciliation and
metadata command recovery; `EntityAccessEditor` owns Packing/Event/Drivers/Activity audience/administrator drafts, discovery and
reviewed commands. Standalone Surveys supply no Access operations, and their metadata tokens remain representation
comparison evidence without adding write preconditions.
Features inject generated operations, query dependencies, normalization, field controls, authorization inputs and
native wording. These owners compose the existing query/draft/command helpers rather than keep a second server store.
Packing and Drivers use `useListActions` for membership, item/assignment removal and Quick Add. Pass their actual
operations and live draft collector/reset; the shared owner delegates dispatch and unknown delivery to the existing
command. A confirmed creation resets only the feature's submitted draft; rejection or uncertain delivery retains it.
`useMetadataEditorHandle` exposes the current mounted editor's public workflow through its field adapters, including
its absent-editor defaults and propagated recovery failures. It derives flags rather than copying them. Nullable text
normalization is shared by explicit field opt-in; it does not apply Event capacity or deadline policy to other fields.
Preserve independent drafts and layout; file size alone is not a module boundary or justification for a universal CRUD
engine, forwarding controller or backend service. `EntityHeaderEditor`, `EntityEventEditor` and `EntityLifecycleActions`
remain explicit lower controls. Their settings, dialog, metadata and access contracts live in the corresponding
`src/types/FrontendEntity*.d.ts` declarations. Packing, Drivers and Activity supply their optional event-association operations.

`TimezonePicker` and `TimezoneOptions` share Event creation/property timezone selection, search, common zones, browser
detection, aliases and offsets. Feature metadata normalization coordinates a changed zone with its displayed local
deadline; an unrelated sparse save omits both fields and preserves the stored instant.
Pass the reactive selected interface locale to date/timestamp formatters rather than relying on browser-language
defaults. Event summary, saved attendance, roster and registration-link consumers share their existing feature
presentation helpers. Their date-only values use the shared civil-day policy above; deadlines and registration-link
timestamps remain instants, and the summary deadline keeps its explicit Event zone or omitted browser-zone option.
Translation changes wording without rewriting stored values, feature drafts or local-minute input policy.

`EntityHeader` is the displayed header used by Event, Packing, Drivers, Survey and Activity detail; `EntityHeaderEditor` handles the separate
upload draft. Pass the admitted title/icon, parent URL, image read/version/exact query key and settings state to the
displayed owner. Cover-image presentation and parent navigation live in this shared owner; responsive styles may
reflow its tracks while retaining the admitted image, title and visible parent action.
Event's dashboard heading remains distinct. Its successful-read subscription includes equal-version responses;
recovery waits until new props render and rechecks resource/key before the existing image owner reads. This prevents
an admitted absence from retrying a retired image while preserving a healthy URL. Parent URLs are used as supplied.

Audit logical value lifetime, including warm navigation. Feature drafts and controls must agree after accepted
departure, target changes and confirmed reset. Ordinary reads, fragments and canceled departure retain live values;
component lifetime alone cannot identify current form scope. `composables/fileSelection.ts` holds only a DOM ref and
clears the same chooser when the feature releases its File to null. Its watcher is not immediate, so initial setup
cannot erase pre-hydration selection before restoration. Release decisions, dirtiness, commands and tokens stay
in their owning feature or shared interaction composite.
Narrow write-grant loss must preserve a retained File together with its original native chooser while disabling
dispatch; recreating an input cannot restore a nonempty FileList. Settings keeps that local chooser hidden until
the same grant returns. Actor/read denial and accepted departure retain their separate retirement boundary.
The same Settings boundary retains the actual metadata child while its existing dirty/unknown/pending/recovery
state needs that owner. A current projection with no editable metadata hides and disables it, removes its active
read eligibility and keeps other admitted panels usable. Regrant restores that same draft; full read denial closes
the private owner. When an unknown metadata result survives a tab change, the visible dialog footer exposes the
existing parent Refresh owner rather than requiring a hidden child's control.
For Finance creation's explicit participant chooser, retire removed IDs from its existing draft and comparison
baseline without selecting newcomers. Automatic enrollment retains its own current-roster rule; pending/unknown
submissions keep their captured choices until their existing completion/review owner releases them.

Header upload passes the settings owner's `selectedFile` through the declaration contract. Confirmation releases the draft
even when follow-up fails; the editor clears the same input through the shared release owner so the same file can be
selected again. Rejection, unknown delivery and background reads retain bytes/input. Do not infer release from changed
header URL, token or translated filename, recreate the input or emit another selection event to reset it.

`feedback.ts` binds notices to semantic receipts and owns their ten-second scheduling/cancellation lifetime.
Repeated outcomes renew; locale/render changes neither renew expiry nor revive dismissed notices. Persistent
conditions use status semantics and remain visible. `App` and `AppDialog` supply common page/dialog notification
hosts through the read-only `noticeTargetKey` presentation reference. A sticky host reserves the visible stack's
natural height at its origin and releases it when empty; the bounded stack keeps dismissal reachable. Notifications never call focus or
scroll to reproduce native submission/refresh jumps. This shared rule supersedes the historical local reveal behavior.
Confirmed destinations/receipts survive failed delivery; warnings clear only through their own successful recovery.
Dispose timers/listeners and preserve page-cache restoration behavior.

`CommandFeedback` presents the existing command owner's read-only error, notice and uncertainty refs across identity,
Packing, Event, Drivers, Survey, Activity and Overview consumers. Features retain outcome wording, commands, drafts and recovery;
the shared renderer chooses notification placement. `StatusNotice` accepts `placement="notification"` for both
transient results and durable action/recovery feedback. Only transient receipts expire or offer dismissal; durable
conditions remain visible until their actual owner resolves them. Ordinary read warnings remain contextual when
they do not belong to a common action receipt.
A common read-failure receipt retains its caught Error identity. An application-context set of mounted presentation
readers hides only an ordinary notice for that exact Error while the common notice is actually visible; missing
or different errors and hidden common notices remain independent. The common notice borrows matching live
freshness/deadline values without copying query state. Its guarded Retry delegates to the actual command owner's
read lifetime and clears only the receipt/error renewal it recovered.
Activity's registration hint and requirement-progress summary adopt that same renderer as persistent content;
the progress summary adds no live role, dismissal or expiry to its existing informational presentation.
`StatusNotice` receives an action label and optional existing action state, then emits the user's action. When state
is omitted, its `ActionButton` still applies shared initialization and the caller's handler retains its own guards.
The notice does not choose read eligibility or perform recovery. Text and actions occupy separate columns, with
actions on the right and long text wrapping independently. Phone layouts place each action on its own full-width
row. Use the shared `frontend-action-row` for ordinary page/form action groups; table answer controls, compact header
icons and filters retain their own layouts. Their contracts live in
`src/types/FrontendFeedbackTypes.d.ts`. Share repeated receipt/action presentation through these owners rather than
copy their expiry, disabled state or dismissal wiring.

Packing, Drivers and Survey pass the optional `creationReview` descriptor to `CommandFeedback` for their matching
unknown-creation paragraph/button. Features retain the required flag, catalog wording, read action and paragraph
margin (`mb-2` for the lists). `reviewCreation` emits to the existing `reviewUnknownCreation` owner; feedback itself
does not read, acknowledge or replay a command. Custom notice slots and callers omitting that descriptor retain
their existing behavior. The descriptor remains a read-only declaration in the same feedback contract owner.
Pass existing dismissal locks and contextual margin choices explicitly; presentation must not infer them from pending
status. Do not capture command initiators or add per-feature feedback targets, placement or reveal behavior.
Use `StatusNotice`'s `no-margin` input for a zero-margin consumer; adding `mb-0` beside its default `mb-3`
leaves conflicting owners and can retain the default spacing.
Check feedback inside the actual page/dialog hosts, including initial hosted SSR receipts and injected descendant
notifications. One renderer and scope host must retain each receipt rather than recreate it inside feature markup.
`AppDialog` supplies a persistent `feedback` slot outside its disposable body. A confirmed close moves that same
receipt to the inherited page host, preserving its original lifetime; rejected and uncertain operations retain
their existing draft and review controls. Do not render parallel page/dialog copies of a command's feedback.
Use a real long page to verify sticky placement and retained viewport context after an actual command; DOM-only
focus/scroll spies cannot establish CSS containing-block behavior.

Dialogs share one focus trap/dismissal owner, pending close lock and actual invoker return. Features can supply the
body-field initial target. Tabs retain independent drafts and freeze while necessary work is pending. Avoid
simultaneous Vue/Bootstrap DOM ownership. Mixed navigation disclosures use the existing app-owned wrapper and its
established native key policy.
Reduced-motion styling also covers the actual dialog portal root: its pending spinner can render outside
`.frontend-app` while retaining the same shared action owner.

Authorized images use the shared injected read/lifetime owner with cancellation, generation checks and object-URL
cleanup. A missing optional image does not fail the resource. Equal successful reads can restore a failed image;
access denial cannot be repaired by a retained URL or foreign-scope result.
`app/transport.ts` shares bounded binary response validation through `headerImage`; Packing, Event, Drivers, Survey and Activity APIs retain their
generated operation selection. Its `requireComparison` also shares strong comparison-header checks without choosing
feature field policy.

#### Localization and runtime Help

One catalog per language supplies localized UI/API text, generated keys/parameters and fixed `help.directory`.
Use the shared typed translator and request/application-local i18next-vue binding, without a second dictionary.
Plain interpolation stays escaped; locale changes preserve drafts, focus and machine-value parsing. User-authored
titles and other content remain data rather than translation keys.

Catalogs own plain text, cardinal plurals and explicitly declared component placeholders. Generation validates
complete keys, scalar parameters, plural variants and permitted component names in every language. The shared
i18next-vue binding receives only authored application nodes; raw catalog HTML and undeclared elements are rejected.
All non-user-generated interface wording uses these catalogs, including accessible names and validation. Context/
ordinal extensions remain outside the approved grammar; user records remain data rather than translation keys.
The current preference is a server-issued browser cookie, not a User/Guest or participation-profile database field.
The [framework decision](decisions/DEC-006-FRONTEND-FRAMEWORK.md#deferred-localization-and-domain-integration-targets)
retains the original intended persistence and output-localization choices with their unimplemented status.

After confirmed locale change, cancel/invalidate only named translated query families from the existing query-key
owner. Machine values, user titles, event options and edit authority retain language-independent keys/in-flight
reads. Avoid tuple-position matching or another family registry. Translation cannot cancel the fresh post-command
read restoring metadata/settings authority. `belongsToLocalizedQueryFamily` selects the existing Help, Overview and
translated Event-finance families. Other Event projections remain language-independent.

Help treats the normalized article/search and fragment as its reading visit; locale-only URL changes and Refresh
do not renew anchor navigation. Router owns both deliberate anchors and saved browser history, waiting for Help's
existing admitted read or terminal error through the navigation module's mounted readiness registration. Help must
not scroll independently after a late read. While a translation temporarily hides the former-language body, the existing Help
section may retain only its last readable visit's measured minimum height so removing content cannot clamp the
reader's position. Release that presentation space on a different visit, readable replacement or terminal error;
do not copy article/request data or restore focus/scroll in response to Refresh or translation. The built Help history/Refresh/locale journey in
`tests/e2e/frontend-core.spec.ts` exercises actual anchors, Back, retained search input and a delayed real translated
read. Its execution receipt is separate from this source contract.

One fixed `docs/user-guide/` tree contains reviewed catalog-selected corpora and adjacent assets packaged with the
application. Only the trusted reviewed Help source is searched/read/served. Runtime source/security tests use
independently specified synthetic fixtures, not maintained prose or expectations taken from the selector under test.
The [Documentation Policy](policies/DOCUMENTATION_POLICY.md#localized-help) owns source/fallback authoring rules.

Prefer complete localized articles, stable anchors, search text and raster images/captions/alt descriptions.
Missing corpus/article/required figure selects the complete reviewed English article and its own assets, with
localized fallback notice, English navigation/search markers and actual `contentLocale`; interface locale stays
selected. Never resolve one missing figure across languages or author a cross-language local reference. Article,
navigation and search projections share complete-source selection. Invalid existing localized content fails rather
than fall back. Source directories stay fixed. Authored hints use `resolveSupportedLocale`: a regional hint may name
the same corpus, but unsupported or other-corpus hints cannot pass through passive English negotiation.

Keep Help prose/pixels task-focused; framework/API/storage/permission internals belong in maintainer guidance.
Every changed picture needs individual full-resolution and reduced-size inspection. An untrusted content source
requires reopening [DEC-004](decisions/DEC-004-HELP-MARKDOWN-TRUST-MODEL.md) before admission.

### Root property dialogs

Keep the field-to-permission policy and page projection in `entityAdminController`; add feature normalization to the
existing feature controller and atomic persistence to its existing database service. Pass admitted field/capability
projections explicitly to shared controls. Shared contracts remain `.d.ts` declarations.
Only editable values enter the projection, and the browser sends only changed fields. APIs reject unknown or
unauthorized fields before persistence; an omitted checkbox is unchanged, while an explicit false clears it.

Feature draft/query/command owners coordinate each dialog's independent sections. Shared header/event/lifecycle
panels provide repeated layout and explicit events; they retain no business tokens or second file draft. Validate local
prerequisites before admitting a command. Keep selection IDs separate from discovery labels. Exports/modified clicks
leave the source draft protected, while tab changes retain independent input. Presentation-only audience/search state
does not become a business patch. Validity reporting reveals the invalid field's family before focusing it.

Event creation and association writes authorize the submitted destination with effective
`MANAGE_ASSIGNMENTS`. Reassociation also needs the child's current `EDIT_META` and the expected previous event ID.
Keep relationship persistence and deterministic parent/child locking inside `EntityLifecycleService`; activity
invalidation is decided by the activity controller using its existing persistence/job boundaries. Shared discovery
owners provide server validation, permission-prefiltered database pages, a final engine check and opaque continuation
tokens. EventPicker receives the feature's generated discovery operation and query families: Packing injects
`searchPackingEvents` through `PackingApi.events` at `/api/v1/packing-lists/events`.
The shared picker replaces result pages and retains only current/saved selection labels
plus a bounded cursor history. Never substitute assignment presence
or ownership alone for the shared cumulative evaluator.

Each settings section has an independent save boundary: atomic properties, event association, image, permissions,
administrators, archival, and deletion. The trigger is the union of available capabilities, and unauthorized values
are absent from the render data as well as the DOM. The dialog does not require an unrelated dashboard permission.
Use the [field/action policy](PERMISSIONS_REFERENCE.md#entity-settings) rather than another browser permission table.
Keep specialized activity rules, event registrations and invoice workspaces at their existing feature boundaries.

Closing resolves section drafts; changing tabs preserves them. Before a departing command, resolve other dirty
sections through shared departure protection. Ordinary refresh preserves live drafts. Pending work freezes dismissal and competing commands,
including controls created by late reads. Failures retain input and section-local feedback. Exports and modified
clicks leave the source page's drafts protected. Image, picker and administrator helpers use inline hosts here,
without nested dialogs or second listeners owning the same command.

The event picker separates selected state from search results. Authorized historical, deadline-passed and archived
events remain available. Filters never clear or save selection; **No event** is an explicit null choice. Resolve a
saved/preselected event independently of the current page, and preserve an unchanged relation whose destination
is no longer selectable without disclosing unauthorized parent details. Search has generation/abort protection;
failed paging retains the displayed page and retry direction. Encrypted continuation tokens bind actor and filters,
and the existing service returns 25 authorized options with one lookahead, without denied IDs or unfiltered counts.

Association writes require UUID-or-null `eventId` and `expectedEventId`, reject unknown fields, and detect a changed
relationship under deterministic old/new-parent locks followed by the child lock. An authorized identical target
is idempotent. Persist the TypeORM relation rather than its relation-ID projection; prepare required resulting
admission/capabilities before final commit. Preserve root identity, grants, files, direct archival and stored pause state.
Unlinking removes inheritance only and lets a standalone activity resume its existing schedule.

Activity relinking retains committed slots/assignments, rules, saved overrides and reviewed history. Existing external
assignee policy governs future actions; relinking never registers people automatically. Requirement edits preserve
unchanged saved targets outside the new event without treating them as newly authorized targets. The activity
controller invalidates generated unreviewed work and in-flight jobs using existing service/job owners. Event identity
belongs to the generation fingerprint, and the plan lock checks the relationship before a job result can persist.
This protects relationship races, not every independent registration/requirement write. Date edits reject ranges
that exclude saved slots; they never move/delete slots or clamp the plan to its event's dates.

Protect capability-specific sparse/false/null writes, unchanged deadline/time-zone values, denied drafts and target
privacy at the cheapest relevant layer. Real persistence cases cover atomic saves and relationship preservation;
mounted browser cases cover validity, pending controls and focus. The existing property, activity-integrity and
archival suites own these assertions rather than a completed implementation-plan checklist.

### Named email delivery

Every mailer entry point requires an `EmailRecipient` with `{name, address}`. Use the actual account, guest, or active
profile name; do not infer a person's name from their email address. `resolveEmailRecipientName` collapses whitespace
and selects the first nonblank name from actual identity values, such as a profile name followed by its owner's name or
username. Registration stores the normalized display name and falls back to the submitted username when it is blank.
Addresses containing line breaks are rejected. Nodemailer receives an Address object in `to` so
the recipient display name is preserved. `renderEmail(subject, content, recipient)` supplies exactly one named greeting
before the heading in HTML and plain text, including for older string content or content with an explicit greeting.
Text and recipient names are escaped in HTML, and action URLs retain the HTTP(S)-only check. `createMailOptions` exposes
the same rendering boundary for tests without SMTP delivery.

Shared email contracts live in `src/types/EmailTypes.d.ts`, with direct imports rather than type re-exports from
the mailer. `sectionGroups` can group existing structured sections under one title. A group with `disclosure: true`
uses native `details`/`summary` semantics: supporting clients collapse it until activated, while its actual contents
stay in the HTML without CSS hiding, a hidden attribute, scripts, or checkbox controls. Email sanitizers and native
disclosure support differ; do not promise a particular client's collapsed rendering without client verification.
The plain-text alternative always includes the group title and all section facts, formulas, rounding notes, and links.
`actionPosition: 'beforeSections'` places the main action after the message context but before ordinary sections and
groups in both alternatives. Omitted options preserve the existing layout and action order for other notifications.

### Database changes

A schema change normally requires:

1. Update or add the entity under `src/backend/modules/database/entities/`.
2. Add a migration under `src/backend/migrations/` for existing installations.
3. Run `npm run generate`.
4. Exercise the migration against an appropriate disposable database.
5. Add integration coverage using the production `DataSource` metadata.
6. Update configuration, operator, architecture, or user documentation where the data contract changes.

Never rely on production `synchronize`; it is disabled.

### Entity archival

The existing `entityAdminController` owns shared lifecycle actions and authorized presentation, while `userController`
owns personal overview visibility. Generated v1 adapters reuse those business owners. `EntityLifecycleService`
keeps root selection, parent loading, transaction locks, and archive/restore writes together;
the existing `UserService` owns profile visibility persistence and single-target membership queries; `userController`
decides eligibility under its service-managed lock. Feature services
retain their own membership predicates. `modules/archive/policy.ts` is the single computation boundary, and
`getArchivePresentations` supplies authorized controls to shared cards and notices. Keep these rules out of individual
feature controllers and avoid per-card parent queries.

Lifecycle controls use the existing domain operations:

Generated lifecycle operations express explicit desired state. Archive/restore, automatic-archive pause and personal
visibility retain separate operations and authorization. Their authored API contracts own exact route/body shapes;
unknown delivery still requires deliberate inspection rather than automatic replay.


Controls receive feature-owned generated operations. Packing injects
`archivePackingList` and `restorePackingList` through `PackingApi`; Event injects its root/child lifecycle operations;
Overview injects
`setOverviewVisibility` through its API owner. Each uses the shared transport/validated result and existing
`entityAdminController` or `userController` operation. Neither reusable lifecycle presentation nor a second
controller/service duplicates grants, root/parent policy or visibility eligibility.

`createEntityLifecycle` in `src/frontend/composables/entityLifecycle.ts` shares archive/restore confirmation,
desired-state dispatch and success wording across Settings, Overview and Event Things to do. It composes each
consumer's existing API, command and current translator without retaining state. Callers supply direct/inherited
state and any required confirmation-key override, retaining eligibility and refresh dependencies.
This includes Event/Activity scheduled-restore wording. Settings and Overview adopt its pause/resume confirmation,
dispatch and result wording when their admitted projection exposes an independent schedule. Linked Activity
follows its Event and has no independent automatic controls. Pause remains immediate; resume retains the native
elapsed-schedule warning. The caller still owns current capability checks and root/parent-scoped operations, and
the same command retains uncertain-result/read recovery. Personal visibility and permanent deletion stay separate.

Permanent deletion uses `useEntityRemoval` in that same composable module. Its three current consumers are
`EntitySettingsDialog.vue`, `OverviewRegion.vue` and `EventThingsToDo.vue`. The feature supplies its generated
root/child operation and confirmation/success wording; the shared owner obtains whole-page consent before writing,
admits deletion from the existing receipt's availability, dispatches once and retains the confirmed destination
through failed delivery. Required reads and destination recovery follow the
[shared entry contract](#entry-canonical-delivery-and-outcomes) without repeating the command.
Private drafts and capability checks remain with their actual feature owners.

Never accept profile IDs, timestamps, stored parent state, or other arbitrary fields from the browser. Follow the [archival authority contract](PERMISSIONS_REFERENCE.md#archival-authority-and-personal-visibility), including the survey exception. A private preference may change placement only after existing overview membership is established.

Render lifecycle actions through explicit authorized component projections. Personal actions remain an explicit
card contract; placement comes from the bounded overview service. Commands wait for validated confirmation before
refreshing named affected appearances. The presentation owner never infers archival dates or parent policy.

Archive and restore write only lifecycle fields and do not call deletion, invoice recalculation, or file operations.
Permanent deletion remains the simple repository delete in each existing feature service, with database foreign keys
handling dependent rows. It does not pass through the archival service. Polymorphic visibility preferences may outlive
a deleted target; overview discovery always starts from existing entities, so these rows cannot create cards or grant
access. New and duplicated roots receive fresh IDs and default lifecycle state. See
[Database and Migrations](DATABASE.md#entity-archival-state) for persistence and concurrency details.

### Paged profile overview

Keep overview persistence in `UserService.getOverviewPages`, request normalization and presentation in
`userController`, and shared contracts in `types/UserTypes.d.ts`. Reuse the feature participation query builders and
`EntityAdminService.createManagedEntityQuery`; drivers participation, survey ownership, and zero-mask administration
assignments retain their existing meanings. Event registration or ownership never grants membership in every child.

The service joins personal preferences and uses `EntityLifecycleService` for shared archival query inputs. SQL
placement must agree with `isEffectivelyArchived` and `isHiddenInOverview`. An event represents a child only when both
independently qualify in the same collection and region, before filtering. Apply text/type matching to the underlying
roots, map matching children to those eligible parent cards, then sort and page the combined grid in SQL. Escape
literal search wildcards and retain type/UUID identity. Reuse those predicates for counts, selected-event children,
and fallback cards; do not group or filter a complete hydrated dashboard in application or browser code.

Underlying entity counts differ from displayed card counts: an event container is one card even when it represents
several matches. Collection totals span main/hidden placement; region matching totals and card pagers have separate
meanings. Type choices come from the whole eligible region. Search includes unloaded children, but a matching parent
title does not make its children match. A child match retains its independently eligible event as navigation context;
the sub-view preserves filters until **Show all my linked entities** explicitly clears text/type.

The server limits overview and child pages to 24. Initial main regions contain at most 48 cards; all four loaded
regions contain at most 100, because a sub-view adds its enclosing event. Replace old page DOM, release closed hidden
bodies, and retain only bounded navigation state. One selected event is allowed per region; event expansion does not
persist a preference or change another region. Closing returns to the current overview page; unchanged filters restore
the invoking card/focus/scroll, while changed filters reset pages and fall back to the region heading if needed.

Explicit opening/closing/paging uses history entries, debounced search replaces its entry, and Back/Forward restores
the complete namespaced state. Direct sub-view URLs have ordinary **Back to overview** links. Search/type changes
reset both page numbers. Membership loss, relinking and deletion recompute a valid selection/page rather than leave
an obsolete container. Real scale checks must distinguish bounded rows/HTML/DOM from query scans and response time;
inspect actual query plans before proposing indexes, with matching entity declarations and reviewed migrations.

One service-owned read snapshot covers cards, totals, placement, and lifecycle inputs. Pass its raw `ArchiveSnapshotEntry`
map to `getArchivePresentations`; the shared controller projects effective state without rereading after paging. Batch permission projection for the returned
cards and their necessary parents; a fallback parent's title and link require its `ACCESS_VIEW`. Never reuse a
rendered expansion button as authorization for a later read. The selected event and each child are revalidated on
every request, and stale selections/pages resolve to the remaining valid overview.

Overview adapters share controller normalization and server-owned page limits. Namespaced URL state preserves each
collection/region's filters, pages and selection. `OverviewRegion`, `OverviewItems` and `OverviewCard` divide read/navigation,
grid and card presentation without another server-data store. Read before history commitment; preserve sibling state,
modified-click hrefs, search caret and focus through failed/obsolete delivery. Retire source-owned aggregate receipts
with denied cards; unknown membership is not zero. Shared event **Things to do** retains local filtering. Database work
can grow with membership even when returned cards/DOM are bounded; measure plans and paging before adding indexes.

### Invoice pool calculation and saved changes

`eventPoolController.ts` provides route implementations by orchestrating request context, DBAL data, and the
business modules under `src/backend/modules/invoice/`, following the existing activity feature-folder pattern. It does not
contain the allocation algorithm, persistence policy, message construction, or proof-retention implementation.

| Owner | Responsibility |
|---|---|
| `requests.ts` | Existing request-field validation and normalization. |
| `calculation.ts`, `distribution.ts`, `settlements.ts` | Shared preview/commit allocation, exact rounding and provenance, and signed cumulative settlement projection. |
| `poolOperations.ts`, `invoiceOperations.ts`, `takeovers.ts` | Locked business transitions, input restoration, review policy, and coverage changes. |
| `coverage.ts` | Pure shared saved-coverage evidence selection, pair normalization, pending comparison, and applied old-to-new deltas. |
| `state.ts`, `validation.ts` | Reused revision/membership policy and financial/revision constraints. |
| `wording.ts`, `locales/en.ts`, `presentation.ts` | Catalog lookup, complete messages, plural selection, and consistent signed balance/status presentation. |
| `notifications.ts`, `settlementEmail.ts`, `exports.ts` | Post-commit notices and saved-share email/PDF presentation. |
| `proofs.ts`, `retention.ts` | Proof ownership and configured filesystem boundary, plus the existing cleanup schedule. |

Named feature operations run business checks inside `EventInvoiceService.withLockedPool`, then use DBAL reads and
writes with that transaction manager. `EventInvoiceService.ts` owns queries, root locks, transactions, persistence,
and stored aggregate columns. It throws no request-specific errors and decides no review, calculation, rollback,
or file policy. Repository details stay inside the service. Callers import each module directly; nothing forwards
another module's exports. Each `EventPoolAssignment` stores its own `factor` (default `1`, range `0`–`1000`,
up to four decimal places). Assignment membership and exemption are separate from the factor.
New assignments start at `1`; updating existing assignments preserves factors omitted by a caller.

The shared browser-safe `coverage.ts` policy imports only declaration contracts. Both `poolOperations.ts` and
`presentation.ts` consume it directly; business operations do not depend on a renderer, and the presenter exposes
helpers only on its explicitly passed renderer object. No consumer re-exports those imports. Keep this common
evidence policy separate from locked takeover writes and pure DBAL persistence.

Pool status has three values. OPEN permits participant submissions and self-service takeovers; ORGANIZER_ONLY displays
**Organizer invoices only** and closes both participant actions while retaining organizer costs, invoice review,
allocation editing, and calculation. OPEN and ORGANIZER_ONLY are independent initial states: creation's
**Invoice submissions** field offers **Open for invoices** and **Organizer invoices only**. Omitted initial status
keeps OPEN as the established default; a pool may also be created directly as ORGANIZER_ONLY. Either state can close
directly through the existing financial calculation, with no mandatory submission-access transition beforehand.
**Close participant invoices** and **Open participant invoices**
use a frontend review gate and `POST .../submission-state` with only `status: 'OPEN' | 'ORGANIZER_ONLY'` and the current
`expectedRevision`; confirmation is not an additional API field. The route requires `MANAGE_ASSIGNMENTS`, the
controller checks event ownership, and the named pool operation repeats lifecycle/revision checks under the same
root lock as invoice submission. A changed state advances the revision to invalidate a preview without replacing
costs, assignments, shares, or settlements. Either OPEN or ORGANIZER_ONLY can use the existing calculation command to become
CLOSED; this submission-access operation always rejects CLOSED pools. Organizer expenses remain available in every
state, and invoice review keeps its existing rules.

Apply `1790985600000-AddInvoicePoolOrganizerOnlyState.ts` when upgrading an existing database to support ORGANIZER_ONLY. The entity
enum and migration must be deployed together through the settings-aware migration workflow in
[Database and Migrations](DATABASE.md). Its down migration refuses while any ORGANIZER_ONLY pool exists; explicitly open
participant invoices or calculate and close those pools before downgrading. The migration never decides a business
transition or silently changes participant submission access. It extends the committed OPEN/CLOSED enum directly;
draft, unreleased enum values are not migration compatibility cases.

The generated organizer-invoice operation records an organizer-entered invoice. Require an

authenticated profile, `MANAGE_ASSIGNMENTS`, and a pool belonging to the event; event registration is not required.
Use the existing positive-amount normalization, upper bound and nonblank description. The rendered amount field's
two-decimal step does not impose another shared-operation precision rule. Proof is optional, with the
existing image/PDF validation and size limit when provided. The optional `registrationId` identifies the participant
who paid. Leave it absent for the existing shared-expense default; selecting it must not create pool membership.
Validate the selected registration's event and pool eligibility inside the named invoice operation under the service's
pool-root lock. Persist APPROVED with the selected registration or null, independently recording `recordedByProfile`
and a `recordedByName` snapshot. Profile deletion sets the audit relation to null while keeping the name snapshot.
Participant submissions keep their registration and required-proof contract. Organizer creation remains available in
all pool states and sends no creation email.

Organizer creation uses `FinanceOrganizerInvoice`, its feature API and the shared command owner. A confirmed
validation rejection permits correction; uncertain delivery retains the draft until in-place saved-history inspection
and explicit acknowledgement. The command never automatically retries this non-idempotent cost creation.


Organizer invoices contribute to accepted shared costs. An unassigned invoice creates no personal invoice credit,
including for a recorder who attends the event. An attributed invoice reuses the selected registration's existing
credit, own-history, receipt authorization, and own Accepted-invoice Close rules; enabled invoice deduction credits
that participant or their covering payer. Use the central **Paid by participant (optional)** and
**No participant — shared pool expense** labels, and explain the exact **Deduct submitter invoices from their share**
setting beside the selector. Optional proof applies to either choice. Adding an invoice to a closed pool advances its
revision and marks it stale without changing saved shares or payment markers. The existing nullable registration
relationship supports this option without a new entity change or migration. Keep the committed
`1789603200000-AddOrganizerInvoices.ts` migration unchanged and follow the recorder-audit rollback preflight in
[Upgrading and Rolling Back](UPGRADING.md); its existing down guard protects invoices with no registration.

Use this calculation order:

1. Sum effective amounts of Accepted and Closed invoices. Exclude Awaiting review, Rejected, and Retracted invoices.
2. Subtract the signed sum of adjustments whose `subtractFromPool` is true to obtain the distributable amount.
3. Multiply each non-exempt participant's equal/day/night weight by their factor, then normalize by the sum of
   effective weights. Round each resulting base to cents in the same direction: `roundUpShares=true` (default) uses
   mathematical ceiling; false uses floor. Equal effective weights produce identical bases. Use exact integer ratios
   for the cent boundary; do not distribute leftover cents by participant ID.
4. Add all signed participant adjustments exactly once. Negative amounts are rebates. Factors do not scale adjustments.
5. Deduct effective registration-attributed invoice amounts when enabled, including organizer-entered invoices assigned
   to a participant. Unassigned organizer expenses create no personal invoice credit. Factors do not scale invoice credits.
6. Combine each beneficiary's calculated components into the covering payer without applying the payer's factor again.

`invoiceAmount` is accepted invoice cost, `payableAmount` is the distributable remainder,
`additionalAmount` contains signed on-top adjustments, and `totalAmount` is invoice cost plus those
on-top adjustments. Do not clamp a negative distributable remainder. The preview reports the signed rounding
difference between summed rounded bases and the distributable amount; this small surplus or shortfall is intentional.
The reconciliation is `sum(base) + sum(adjustments) = totalAmount + roundingDifference`, then subtract invoice credits
and prior signed settlements to obtain the net calculated balance. Positive outstanding shares plus signed refunds equals
that net balance. Invoice reimbursement must not be mistaken for a missing share of the pool's gross costs.
A nonzero distributable amount with no positive effective weight must fail before replacing any shares.

Closed pools accept saved settings, assignments, factors, adjustments, and organizer takeover changes.
Calculation inputs invalidate the closed pool through `needsRecalculation` and advance `calculationRevision`.
Closed takeover changes are pending inputs: saving them sends no coverage notification. Read-only views select
applied pairs from the frozen snapshot, falling back to saved contribution attribution only when the takeover list
is unavailable. An explicitly saved empty list remains authoritative; baseline legacy data must never infer applied
coverage from current maps or parsed notes. Before CLOSED, current planning inputs count as known evidence. For CLOSED,
neither a saved takeover list nor saved contribution attribution means an unknown baseline; the pending comparison
returns false rather than inventing an old empty state. Show applied coverage first and **Pending takeover changes**
separately when a known normalized baseline differs, with the organizer chooser editing only those pending inputs.
The header and pending coverage group also show **Takeover changes pending**, keeping a staged relationship visible
before the pool or its detailed draft is expanded.
For an unknown legacy baseline, show the provenance warning and current editable inputs as
**Takeovers for next calculation** without claiming an applied delta.
These applied/pending overviews belong to organizer administration. Participant submission and takeover pool choices
remain OPEN-only; closed personal coverage stays inside the frozen payer explanation rather than additional pool cards.
Attendance and membership changes and accepted invoice changes must also invalidate affected pools.
Payment-state changes update settlement totals and advance the revision to invalidate an outstanding preview, but do not mark the calculation inputs stale. They remain permitted while `needsRecalculation` is true.
Automatic invoice retention is a deliberate exception: deleting expired source records preserves historical settlement
shares and does not itself require recalculation. It still advances the revision to reject a concurrent calculation
that read the deleted records. A later explicit recalculation uses only the records still retained.

`previewPool` prepares the same gross shares used by closing/recalculation and projects prior settlements without writes
or notifications. Its revision must still match when a preview is applied. Recalculation uses saved inputs, preserves
the CLOSED state, and replaces shares in one transaction. A failure keeps the previous shares and payments.
The same locked commit compares previously applied coverage with the final new snapshot, then returns the added and
removed pairs for post-commit notification. Intermediate staged edits, no-op changes, and failed calculations send
no coverage notices. First closure does not repeat planning notifications. These coverage notices remain independent
of `sendCalculationEmails` and a calculation's `sendEmails` override, which control only settlement messages.
A legacy calculation without applied evidence establishes its first baseline without speculative coverage notices.

The optional saved `settledRegistrationIds` identify active nonzero signed carried settlements. Derive those IDs and
credits from one cent accumulator: prior `paymentCreditAmount` plus each newly settled signed `shareAmount`, grouped
by actual payer. Never seed them from old IDs or dates. Preview and commit preserve a correcting share until its transfer
is recorded; the next recalculation clears fully consumed credit and its indicator. Remove a zero covered orphan row,
but keep an allocated exempt zero row as an ordinary share with no historical settlement date. Hard-deleted registrations are excluded.
Resolve retained exemption and coverage indicators through the pure frozen-evidence owner, ignoring pending inputs.
Compare old and new applied responsibility under the existing root lock, then send **Your payment responsibility changed**
after commit independently of optional calculation messages. Exclude those payers from optional bulk messages to
avoid duplicates. Staging, rollback and unchanged recalculation do not repeat the notice. These IDs carry no inferred
gross transaction amounts. Share ledgers, breakdowns, emails and PDF notes use the same localized presentation.

Pool hydration uses `relationLoadStrategy: "query"` inside a `REPEATABLE READ` transaction so multiple child collections
do not multiply into one large join and the pool revision, settings, and saved shares come from one snapshot. Mutations
retain their transaction locks and revision comparisons; optimizing reads must not weaken that boundary.

`projectInvoiceShares` carries money by the actual payer registration. For each previous share, cumulative settlement is
`paymentCreditAmount + (isPaid ? shareAmount : 0)`. The new `shareAmount` is gross liability minus that signed credit.
Positive credits represent money received; negative credits represent refunds made. Repeated calculations preserve the
credit without adding it twice. A previously settled payer who disappears from the new payer set retains a credit-only
share while their event registration exists and a nonzero carried credit remains. Never move that payment to a new covering payer implicitly. A zero
calculated balance requires no transfer. **Record payment** / **Record refund** and **Undo payment** / **Undo refund**
apply to the saved calculated balance, not to past carried credit. Their review dialog is a frontend gate: the existing payment API still accepts
the same `isPaid` payload. Acceptance, rejection, closure, and adjustment removal also have frontend review gates;
existing revision-checked correction/retraction contracts remain unchanged.

`wording.ts` and `locales/en.ts` own shared email/PDF/export messages and the source English invoice wording.
Stable typed keys identify whole messages; named parameters and `Intl.PluralRules` select complete messages.
That catalog currently supplies English with supported-language fallback. Finance uses generated i18next catalogs
and the typed context translator for English/German interface messages and localized saved-data projections.
`src/common/locales/en.json` selects existing English invoice messages by key; `scripts/generate-locales.mjs` reads the
maintained literal catalog and derives generated resources without copying text. Do not copy catalogs, add forwarding
exports or expose server-side invoice business modules as browser entries.


`presentation.ts` owns signed financial presentation and the single settlement-status rule used by the interface,
emails, and PDF exports. The primary **Calculated balance** is the saved `shareAmount` after carried credits,
and stays visible whether settled or not. Status labels contain at most two words: **Payment due** means the named payer
must pay; **Refund due** means the named payer must receive a refund. Recorded transfers use **Paid** or **Refunded**;
a zero balance uses **No payment**. The **Settled** filter combines those final states.
Internally, the unsettled amount becomes zero on settlement, while the signed calculated balance preserves the
amount recorded. Aggregate unpaid transfers use that unsettled amount; views need no duplicate settled or unsettled
component row when the calculated balance and status already explain the transfer. Refunds stay negative throughout.
Compact settlement buttons retain their action label while saving and overlay progress on the existing icon.
The saved result updates status and action wording without recreating or automatically reordering payer rows.
The legacy persisted `creditAmount` stays a positive magnitude and is projected once for display.

Use the existing pure presentation/wording owners directly and pass explicit values to shared controls. Avoid a
second renderer formula or copied catalog. Programmatic hooks are independent of translated labels. Settlement actions use the same
compact outlined button style as the rest of the ledger, with an explicit review gate before any request.

Each newly saved calculation adds optional numeric `explanation` data to the existing JSON snapshot. Attendance totals,
eligible units, factors, exemption flags, per-participant contributions, and exact integer weight ratios come from the
same calculator used for the allocation. Takeovers combine already rounded contributions. Views, notifications, and
exports read that saved explanation; they never reconstruct it from subsequently edited inputs or parsed notes.
Older snapshots keep their saved amounts and show that the numeric basis is unavailable until explicit recalculation.
This JSON extension requires no entity or schema migration. Shared contracts remain in `src/types/InvoicePoolTypes.d.ts`.

Keep invoice overviews focused on meaningful source and settlement context. The collapsed closed-pool header preserves
**Full pool total**, **Payments due**, and signed **Refunds due**. Expanded summaries keep those primary amounts and show
**Base to distribute** when redistributed adjustments are used. The two due totals remain present when every share is settled;
zero outstanding money must not make the settlement summary disappear. Preserve these transfer totals in previews as well.
Distinguish redistributed surcharges, redistributed rebates, on-top surcharges, and on-top rebates whenever each is used.
Positive and negative totals must remain separate even if they cancel: a zero net amount does not mean no adjustment
was applied. A redistributed surcharge reduces the base to distribute; a redistributed rebate increases it. On-top
adjustments leave that base unchanged but change the full total and the affected payer's result.
Fresh CLOSED summaries with known saved cost provenance omit duplicate source amounts already listed in the global
breakdown. Open, stale, and legacy summaries retain applicable current source costs and adjustment categories.
Nonzero **Accepted invoice costs** remain available: the effective amounts of Accepted invoices not yet marked Closed,
rather than Awaiting-review submissions. Saved details retain applicable
**Invoice credit**, **Previously settled**, **Payments received**, negative **Refunds paid**, and **Rounding difference**.
Received/refunded totals show only positive/negative balances marked settled in this saved calculation. Keep carried
credits separately as **Previously settled**, including a zero net aggregate when opposing carried credits are present.
Never infer gross historical payments or refunds from an already netted carried credit.
When stale, label **Current pool costs** and **Saved settlement totals** separately. Preview reconciliation and share
component rows/columns expose invoice credits, previous settlements, adjustments, and rounding differences only when
applicable. Omit unused amount rows and unrelated derived totals without removing meaningful financial context.
Keep the signed calculated balance primary, with settlement status independent of that amount and saved notes available
in **View breakdown**; omitting inapplicable zero components must not remove the audit trail.

`presentation.ts` owns shared structured calculation projections. Keep contextual source data and explanatory
arithmetic separate as a core representation rule. `invoicePoolCalculationBreakdown` returns the metrics-only
`InvoiceCalculationOverview`, containing global saved cost figures, used signed adjustment categories, and contextual
assigned-participant, day/night, eligible-unit, exemption, and total-weight metrics. Its type has no formula,
description, or note-item fields. Never place equations or explanatory prose inside the global **Calculation breakdown**.
Missing inputs are a labelled **Saved calculation inputs: Not saved** metric, rather than a prose section or an
invented calculation. For legacy numeric evidence, keep known amounts and use **Full pool total: Unavailable** when
saved provenance cannot establish that figure. Available contextual figures remain in organizer details, previews,
and both PDF variants.
`invoicePoolCalculation` places total/base cost arithmetic and explanation first in **Example calculation**, followed
by one qualifying anonymous payer's arithmetic. Reuse the same saved cost basis for figures and example operands;
renderers must not derive another set of totals or flatten formulas into metric strings. `invoicePayerCalculation`
explains the actual selected payer's complete calculation in the breakdown dialog and settlement email. Keep that personal explanation
inside the breakdown; do not attach an independent pool example or personal-calculation block above each ledger row.
Use the saved real names for every own and covered contribution, suppress unrelated payers, and combine already
rounded base shares before applicable adjustments, invoice credits, and prior settled credits determine the saved
balance. When takeovers are used, show the actual covered count and names before individual beneficiary formulas.
A former payer's credit-only row must never borrow another payer's attendance or base formula.

The anonymous example considers only supplied saved shares with a positive `shareAmount` and an own, nonexempt
contribution attributed to that same payer. Exclude covered participants, exempt payers, refunds, and zero balances.
Prefer candidates without beneficiaries, then candidates with positive own effective weight within each coverage
group, then an own redistributed surcharge before the largest number of actual nondefault-factor, adjustment-category, invoice-credit, and prior-credit
features. Reuse the financial component projection so cancelling signed source categories still count and unreliable
historical categories keep their honest net fallback. Break ties by saved registration identity; names, current
profile, and input ordering must not choose a different example. Order covered contributions by saved identity too.
A positive fixed balance with no own automatic weight may serve as a factual fallback, showing its zero-base inputs
without division. If coverage is unavoidable, its introduction states the true number of other beneficiaries before
any payer formula. If no candidate qualifies, retain a cost-only **Example calculation** when saved numeric evidence
can explain the pool totals; its introduction names that purpose and introduces no participant. Never manufacture a
refund, exempt, or legacy personal example from missing provenance. Entirely missing explanation data produces no
example heading; legacy numeric evidence may retain honest cost arithmetic while disclosing unavailable provenance.

Personal explanations abbreviate exempt or zero-weight rows when none of their own or covered contributions has
positive nonexempt weight. Omit unrelated shared cost/divisor sections while retaining coverage names, exemptions,
actual zero-weight inputs, applicable fixed adjustments and credits, and the signed saved final balance. If an
eligible covered contribution has positive weight, retain the shared context needed to follow its base calculation.
Personal explanations retain relevant self-contained distribution numbers and omit the global **Full pool total**
equation; explain only the payer's applicable on-top adjustments beside their final balance. Pool cost explanations
separately name **Invoice costs**, **Base to distribute**, and **Full pool total** when used adjustment modes make those
scopes differ. Full pool total is invoice costs plus signed on-top adjustments; base to distribute is invoice costs
minus signed redistributed adjustments. Ordinary pools without adjustments use one cost metric; explain that equality
only inside **Example calculation**, preserving the ordinary labels. Keep used signed adjustment categories and relevant
cost scopes distinct even when their amounts coincide. An older snapshot lacking category evidence discloses the
unavailable full total within the example. Redistributed adjustments move costs between
the shared base and the affected payer without changing the full pool total; on-top adjustments change the full pool
total and affected payer's balance without changing the shared base.

These projections use shared arithmetic building blocks and `.d.ts` contracts. Keep the metrics-only overview distinct
from explanatory sections with named formula terms, results, and rounding notes. Render explanation structures as
labelled, formatted steps in the interface and email; render global figures only as labels and values. Avoid a large unformatted
paragraph or a separate renderer-specific formula implementation. Name every applicable multiplier
and divisor, including attendance in the saved distribution mode, share factor, and total weight. Use actual saved
values and rounded contributions. Explain only used adjustment categories and why they change the shared base or
full total. Saved calculation notes record actual facts; they neither replace the arithmetic explanation nor become
anonymous examples. Keep the original `share.note` intact and escaped in app, PDF, and email; its established bullet
separator only divides saved items for rendering. Ordinary email messages, labels, and actions directly address the
recipient; immutable notes and the full named explanation retain their recorded attribution and authored descriptions.
Never synthesize replacement notes, rewrite historical phrasing, or put a second **Saved source notes** section inside
the calculation. Settlement emails show **Saved calculation notes** before and outside the optional
**Calculation explanation** disclosure. Keep the main signed balance, status, context, and leading action visible
before either section; plain text retains every original note and concrete calculation step.
All explanatory sentences and component labels remain catalog-owned. New snapshots may store optional numeric
adjustment provenance in the existing JSON contract. For older snapshots, read available frozen provenance or disclose
its absence; never infer gross categories from a net zero amount, parse notes as numeric evidence, or use current edits.

A successful calculation saves `calculationSnapshot`: pool-local settings, assignments/factors, adjustments, takeovers,
and a fingerprint of external calculation inputs. `rollbackPoolChanges` restores those local inputs transactionally
without touching shares/payment records or sending emails. Event registrations, attendance dates, invoice reviews,
and organizer-entered invoices are not reverted. The external fingerprint includes every counted invoice's identity,
registration attribution, and effective amount, including both unassigned and participant-attributed organizer costs.
Adding either kind after calculation leaves the pool stale after local rollback. A fingerprint mismatch or
missing registration leaves the pool stale after local rollback. Legacy
pools without a snapshot cannot roll back until a successful calculation establishes one.
Rollback uses the same pure coverage selector to restore older contribution-certified pairs when the explicit
takeover list is missing. If neither frozen source is available, reject with the existing incomplete-snapshot error
before any input writes; retain current inputs, shares, and payment records without inventing prior coverage.

`sendCalculationEmails` is the pool's stored default; close/recalculate accepts a `sendEmails` override. Notification-only
settings changes do not require recalculation. A separate closed-pool notification endpoint sends the saved settlement
without recalculation. Its organizer dialog closes only after confirmed success and pending-state cleanup; failed or
unconfirmed requests keep the dialog open with feedback and restore its controls. Preserve the existing endpoint and
request contract. `buildInvoiceSettlementEmail` reads `isPaid`, signed payment credit, and the residual amount so
settled shares never appear outstanding. Notification delivery is queued after persistence, outside the transaction.
Invoice acceptance, rejection, and closure also confirm persistence before queuing SMTP delivery. Catch and log delivery
failures independently of the financial response. If a review loses a concurrent state transition, return 409 and do not
send a notification implying that the losing review succeeded.
For participant-attributed organizer invoices, calculation credits, review notifications, and own-history/proof access
follow the existing registration relationship; the independent recorder audit does not confer ownership or change the
recipient. Creation itself retains its existing no-mail behavior.

Accepted and Closed invoices support `POST .../invoices/:invoiceId/revise` and `reject-accepted` for authenticated
organizers with `MANAGE_ASSIGNMENTS`. Both require JSON `confirmed: true` and the current pool `expectedRevision`;
an extra confirmation dialog displays the proposed change before committing.
Versioned commands use generated decimal-string amount contracts before shared normalization and the existing business
operation; null corrected fields restore the original value. The wire spelling adds no precision restriction or changed calculation.
Revision preserves the Accepted/Closed status and original fields. Retroactive rejection requires `rejectionReason`, changes

status to REJECTED, and retains existing corrections as well as original details, proof, and recorder attribution.
Both invalidate a closed pool without changing saved shares or payments. These external invoice changes survive
pool-local rollback and are included by the next calculation. The original submission and current correction fields
are preserved; there is no separate chronological review-audit table.

`POST .../invoices/:invoiceId/retract` uses the same confirmation/revision contract but requires ownership of the NEW
invoice through the active profile's registration, with no administrator override. It works in all three pool states,
persists RETRACTED, and retains details/proof. Because NEW invoices were not counted, retraction advances the pool
revision while preserving its current stale flag, shares, and payments. Named correction/rejection/retraction receipts
are queued after commit. Apply `1789689600000-AddInvoiceRetraction.ts` to extend the stored enum; its down migration
refuses while Retracted invoices exist instead of rewriting or deleting history.

`FinanceSubmission` owns its mounted draft/proof/progress and uses its feature API with `useCommand` to refresh
admitted Finance data in place. Confirmed save releases only completed fields while retaining an eligible pool;
unknown delivery retains the draft until explicit saved-history inspection and acknowledgement. SMTP delivery is
separate from persistence confirmation. An uncertain proof upload is never automatically resent; validation
rejection remains distinct from possible committed delivery.


Pool mutations use `useCommand`, `CommandFeedback` and the common page/dialog notification hosts;
feedback never moves document focus or scroll, and confirmed results survive a failed following read without replay.
Amounts and settlement state change only from confirmed saved data. Pending work remains visible and
**Refresh list** is acknowledged even when the results are unchanged. Matching commands share these existing owners.


The share ledger searches, filters, sorts, and pages the saved rows in the browser. Confirmed payments update row status
without rerendering the current list, keeping settlement actions in their current rows. **Refresh list**
or a search/filter/sort/page change reapplies the controls; an active status filter highlights the refresh action after
a payment update. Participants use the same ledger design across their own pool shares, with pool-name search,
status filters, sorting, configurable page size, and pagination suitable for hundreds of pools.
Consumers share `FinanceShares` and one lazily populated `FinanceBreakdown` dialog rather
than creating a dialog for every pool. The **Share breakdown** dialog shows saved components, formatted concrete
calculation steps,

and separate saved notes without expanding the table. Settlement emails place notes before the full calculation explanation. The portrait A4 PDF export at
`GET /event/:id/export/invoice-pools/:poolId/shares` requires `MANAGE_ASSIGNMENTS` and verifies that the pool belongs to
the event. It exports the complete persisted share set, independent of browser filters, with current payment status
and a stale-calculation notice when needed. Export must never recalculate or record payments.

The descriptive caption under the calculated balance uses only its saved sign and settlement marker: organizer
**Amount to collect** or **Amount to pay out**, participant **Amount to pay** or **Refund to receive**, and
**Already settled** or **No payment due**. This restores the existing caption behavior without adding another amount.

Both shares PDF variants place the global **Calculation breakdown** above the table as a list of contextual numbers,
including applicable cost, adjustment, and distribution metrics. The default **Export shares PDF with example** adds
**Example calculation**: total/base cost explanations and arithmetic, followed by one anonymous payer's steps when
a positive payer with reliable saved contribution evidence qualifies. A usable cost-only example remains valid
without a qualifying payer; never invent a person to keep that explanation visible.
**Export shares PDF without example** selects `?example=false`, validated by the existing invoice request module into
`InvoiceSharesPdfOptions.includeExampleCalculation`. It omits every generated explanation and formula, including
transfer-scope and stale-calculation paragraphs. Authorization, global contextual figures, saved share rows, original
factual notes, settlement status and dates, and settlement totals remain identical. A stale compact PDF uses the short
**Recalculation required** label. Do not render an empty example heading when numeric explanation data is entirely absent.
Organizer pool views put that structured example in a separate collapsed **Example calculation** disclosure beside
the figures-only **Calculation breakdown**. Previews use the same separate, collapsed sibling disclosure; their
global breakdown must remain exclusively a list of contextual numbers.
Keep this pool-level example distinct from concrete payer explanations in dialogs and emails. Combine any general
calculation hint with the example and omit
implementation references such as screen filters. The table owns every payer's applicable component amounts,
calculated balance, and settlement status. Preserve saved row notes,
but do not repeat the calculated balance or add the base formula beneath every payer. A recorded settlement contributes
its date to the notes, without repeating the amount already visible in the table. **Saved settlement totals** retain
**Payments due** and signed **Refunds due**, applicable invoice credits and previously settled credits, and transfers
recorded in this calculation as **Payments received** and negative **Refunds paid**. Do not infer gross historical
transfers from netted credits or repeat derived net balances and payer counts.
Reuse the shared `sectionTitle` heading for **Calculation breakdown**, the example, **Saved settlement totals**, and
**Calculated shares**.
In the with-example variant, keep one complete formula per row; independent equations must not share a cramped
side-by-side row. The without-example variant must not render formulas or explanatory paragraphs anywhere.
The PDF's `pageBreakBefore` policy moves every visible financial cell with ordinary saved notes. Allow oversized notes
to wrap across pages normally; globally unbreakable groups or `dontBreakRows` can lose content and must not be used.
After every change affecting PDF content or layout, regenerate representative exports and visually inspect every page,
including long names, detailed notes, negative amounts, and page breaks. Definition-level tests alone cannot verify
the rendered PDF's readability or prevent visual regressions.

Takeover overviews use Bootstrap tables with one payer per row and beneficiary badges in the adjacent cell.
`FinanceCoverage` shares search, payer paging, beneficiary disclosure and explicit payer-edit events.
Each group initially shows six beneficiaries; **Show all** expands its badges within a bounded scroll area,

and **Show fewer** collapses them. A beneficiary search reveals matching badges beyond the initial preview.
Editing stays in **Manage takeovers**, opened directly for the selected payer by the row's **Edit** button.
Applied coverage in a CLOSED pool is read-only; row editing belongs to its separate pending-input overview.
On small screens the same table cells stack with their labels, retaining the payer and beneficiary relationship.

Protect calculation arithmetic with unit tests, persistence and recalculation with the invoice integration suite,
and upload state transitions with frontend tests. Use a real browser for dialog wiring and the saved-edit workflow.

## Test selection

Use the cheapest layer that protects the behavior, then add broader coverage when a boundary is crossed:

```bash
npm run test:unit          # isolated server-side logic
npm run test:frontend      # browser helper and DOM-adjacent logic
npm run test:quick         # configured database-free project, including scoped server integration
npm run test:integration   # production services/workflows against disposable MariaDB
npm test                   # all Vitest layers
npm run build
npm run e2e                # focused Playwright flows; managed built server
npm run test:frontend:browser # isolated built-browser client behavior
npm run test:all           # Vitest + build + client browser + system E2E
```

The database-backed integration project rebuilds its selected MariaDB schema; the separately selected database-free
server-component fixtures use the other existing project without a schema reset. The E2E initializer drops
and recreates its selected schema. Read [Testing Guide](TESTING_GUIDE.md) before database-backed suites and never
reuse development or production database names.

## Common change recipes

### Add or change a page workflow

1. Find the existing top-level mount in `src/backend/app.ts`.
2. Add or update the feature route under `src/backend/routes/`.
3. Add normalization/orchestration in the corresponding controller.
4. Add persistence operations in the corresponding service module.
5. Update the feature component, generated read/command contract and shared catalog together when values or actions change.
6. Add tests at the lowest useful layer and an integration/E2E check when the change crosses those boundaries.
7. Update the relevant user or maintainer document in the same change.

### Add or change an API action

1. Author the versioned operation/schema once in `contracts/api/v1/` and regenerate its consumers.
2. Add its adapter under the existing API route owner and confirm explicit mounting.
3. Apply validation and authorization before the mutation.
4. Use generated validation and the shared API error chain. Prepare a mutation's validated receipt before commit for
   new or deliberately changed business behavior; unchanged shared operations retain their recorded scope under the
   [development policy](policies/DEVELOPMENT_POLICY.md#scope-of-separately-authorized-work).
5. Cover invalid input, unauthorized input, success, and state persistence.

### Add a client-side module

1. Reuse an existing component/composable; add a feature owner under `src/frontend/` only when its responsibility is distinct.
2. Import its actual declaration/domain owner directly, with no forwarding exports or browser-unsafe dependency.
3. Use the integrated `npm run server` workflow for HMR; check client/SSR through `npm run typecheck:frontend` and build through `npm run build:frontend`.
4. Add a mounted client/helper check at the cheapest meaningful boundary; use isolated browser or system E2E only for its distinct risk.

### Change a setting

1. Add the field, default, key mapping, and coercion in `src/backend/modules/settings.ts`.
2. Update [Configuration Reference](CONFIGURATION.md).
3. Check E2E-prefixed behavior when the setting affects E2E startup.
4. Evaluate database, release, secret, and upgrade implications.
5. For costly behavioral drift, add the cheapest stable test of the executable setting. Use optional documentation
   reports for maintained prose; never assert against documentation in application tests.

## Git and automation

The repository does not currently enforce a branch-name pattern or commit-message convention in committed configuration. Follow the maintainer's requested workflow rather than inventing one in documentation.

The CI workflow runs for manual dispatch, reusable calls, and pushes or pull requests on:

```text
master
dev
ts-migration
```

Before requesting review, run the checks appropriate to the change. A broad application change normally warrants:

```bash
npm test
npm run build
npm run e2e
```

Documentation reports are optional, not review or delivery prerequisites. Use `npm run docs:check` for maintainer
feedback; findings, metadata, baseline changes, or unavailable documentation tools must not block application work.

The manual release workflow invokes full CI, updates the requested semantic version, commits the version files, tags the selected ref, builds, and publishes the production archive. Do not manually alter generated release contents as a substitute for changing source and rebuilding.

## Debugging and troubleshooting

### Startup fails before the server listens

Startup requires settings, MariaDB, invoice-retention and entity-archival initialization, and application construction. Read the first error printed by `src/backend/server.ts`; common causes are an unreachable database, a missing generated TypeORM index, invalid database credentials or archival configuration, or a schema that has not been initialized/migrated.

### A standalone TypeORM command cannot load entities

Run:

```bash
npm run generate
```

Then repeat the settings-aware `npm run typeorm -- ...` command. Confirm `SETTINGS_FILE` and the effective database target before any destructive operation.

### Browser changes do not appear

Use the integrated `npm run server` workflow for Vue HMR and ordered generated inputs. If an authored contract/catalog
save fails, correct it and wait for successful readiness before relying on a restart. For compiled runs, build before run.


### Secure login loops behind a proxy

The production cookie is secure and the application trusts one proxy hop. Confirm HTTPS termination and forwarded-protocol/host headers using the [operations runbook](OPERATIONS.md).

### Local registration succeeds but no activation message arrives

Surveyor logs SMTP send failures and does not provide a built-in mailbox. Verify the configured development SMTP service, sender, credentials, and `ROOT_URL`.

### Tests refuse to reset a database

This is a safety feature. Vitest integration setup requires `TEST_DB_NAME` to contain `test`; the E2E initializer requires `E2E_DB_NAME` to contain `e2e`. Create dedicated schemas rather than weakening the guard.

### Review in-app help changes

In-app guides are application content, but their maintenance is not a delivery prerequisite. Optional reports can
help identify wording, link, asset, and workflow drift:

```bash
npm run docs:check
npm run docs:check:strict
npm run docs:test:content
```

For an actual help-renderer or routing code change, run the relevant application fixture tests. To review the maintained
help pages in a browser, use the optional browser report after preparing its disposable environment. Neither corpus
checks nor documentation findings block CI or release. Reporting and visual-inspection practices are described in
[Documentation Policy](policies/DOCUMENTATION_POLICY.md), [Testing Guide](TESTING_GUIDE.md), and [In-App Help Visuals](features/help/HELP_VISUALS.md).
