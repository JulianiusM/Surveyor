# Surveyor Architecture
<!--
documentation-metadata
audience: maintainers; developers; AI agents
owner: architecture maintainers
status: current
last-verified: 2026-10-26
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: approved local browser assets, responsiveness and dependency compatibility scope reconciled; startup renderer module readiness and prior P11 routing, Vue rendering and native browser retirement guidance retained alongside inherited domain and database safety; no deployment or exhaustive verification claim
source-anchors: package.json; src/app.ts; src/server.ts; src/modules/frontendAssets.ts; src/modules/frontendRenderer.ts; src/frontend/; src/routes/; src/controller/; src/modules/database/; src/modules/api/; contracts/api/v1/; src/locales/; scripts/generate-api.mjs; scripts/generate-locales.mjs; scripts/watch-frontend-inputs.mjs; vite.config.mts; vitest.config.mts; playwright.config.ts; playwright.frontend.config.ts; playwright.integration.config.ts; docs/decisions/DEC-006-FRONTEND-FRAMEWORK.md
next-review: architecture-or-help-delivery-change
-->

Surveyor is a TypeScript monolith that serves HTML and JSON from one Express process. MariaDB stores application
records and sessions; the filesystem stores uploaded header images and invoice proofs. Vue supplies request-local
server rendering and browser interaction. Express retains routing, sessions, authorization and deployment ownership;
the same existing controllers and database services serve every transport.

This document defines the current technical shape of the repository. Configuration, database operation, production deployment, and recovery procedures are maintained separately in [Configuration](CONFIGURATION.md), [Database and Migrations](DATABASE.md), [Production Operations](OPERATIONS.md), and [Upgrading and Rolling Back](UPGRADING.md).

## System context

```text
Browser
  | HTTPS in production
  v
Reverse proxy / TLS endpoint
  |
  v
Express 5 application
  |-- request-local Vue HTML and static assets
  |-- generated versioned JSON/multipart API
  |-- explicit document adapters for provider, token, print and download boundaries
  |-- database-backed session middleware
  |-- local-account, guest, and OIDC identity flows
  |-- permission and shared feature-flow middleware
  |
  +--> MariaDB: entities, relationships, migrations, sessions
  +--> filesystem: header images and invoice proofs
  +--> SMTP service: activation, recovery, and workflow email
  +--> OIDC provider when enabled
```

Surveyor currently assumes one application process owns its in-process schedules, including invoice retention and entity archival. Multiple replicas require deliberately shared upload storage and coordinated ownership of scheduled work; see the [operations runbook](OPERATIONS.md).

## Current technology baseline

The lockfile is authoritative for exact installed dependency versions. The important architecture selections are:

| Area | Current implementation |
|---|---|
| Runtime | Node.js; CI and release workflows use 24.15.0 |
| Language | TypeScript 6.x targeting ES2024; see [compiler API compatibility](DEVELOPMENT.md#1-install-dependencies) |
| Web framework | Express 5.3.x |
| Component UI | Vue 3/TypeScript, Bootstrap-compatible presentation, native controls and suitable Reka UI primitives |
| Routing and server snapshots | Vue Router and TanStack Vue Query; feature-owned drafts remain separate |
| Browser/SSR build | Vite with separate client and SSR outputs; Sass compiles the standalone print stylesheet |
| Shared localization | i18next with i18next-vue, generated typed keys/parameters and shared catalogs |
| Persistence | TypeORM 1.1.x with MariaDB/MySQL driver support; MariaDB 10.11 is the tested workflow baseline |
| Sessions | `express-session` with `connect-typeorm` and the `Session` entity |
| Input validation | Authored OpenAPI with generated declarations/Ajv standalone validators; existing Joi/express-validator adapters retain operation-specific decoding |
| Authentication | Local username/password, guest links, and direct `openid-client` OIDC integration |
| Email | Nodemailer SMTP |
| Tests | Vitest for unit/frontend/integration; Playwright for focused E2E |

## Startup sequence

`src/server.ts` is the runtime entry point. Startup is intentionally ordered:

1. `settings.read()` loads configuration.
2. `initDataSource()` initializes the production TypeORM `DataSource` with `synchronize: false`.
3. `startInvoiceRetentionJob()` performs an immediate invoice cleanup and installs the hourly timer.
4. `startEntityArchivalJob()` validates archival settings, performs an initial sweep when enabled, and installs its separate hourly timer.
5. `src/app.ts` is loaded only after the database exists, because application construction obtains the TypeORM session repository.
6. Frontend development initialization retains Vite's source warmup when enabled; installed releases load the built SSR renderer's code without rendering a request.
7. An HTTP server listens on the configured application port.

A failure in any step logs the error and terminates the process. There is no degraded database-free mode.

### Configuration boundary

`src/modules/settings.ts` owns runtime configuration. The effective order is:

```text
built-in defaults < CSV settings file < environment overrides
```

`SETTINGS_FILE` changes the CSV path. In E2E mode, matching `E2E_*` environment variables take precedence over their ordinary names. The settings store must be initialized before modules rely on `settings.value`.

The runtime `DataSource` reads the initialized settings store. TypeORM command-line operations use `migrationDataSource.ts`; `scripts/runMigration.ts` bridges the normal Surveyor settings into the `DB_*` variables expected by that datasource. Maintainer code must preserve this distinction.

## HTTP application and request pipeline

`src/app.ts` constructs the Express application in this order:

1. Disable the `X-Powered-By` header.
2. Configure Pug views under the compiled `views` directory.
3. Install request logging, JSON and URL-encoded parsing, cookies, development middleware and static-file serving.
4. Enable one trusted proxy hop so secure cookies work behind the documented reverse proxy.
5. Create a one-day database-backed session with secure cookies in production and `SameSite=Lax`.
6. Install flash messages.
7. Mount `/api/v1`, which owns structured session admission and `ApiProblem` responses, then expose `GET /healthz`.
8. Admit document requests through the shared actor and presentation helpers.
9. Mount the Home, Users, Survey, Packing, Activity, Drivers, Event, Help and Guest domain routers in explicit order; each owns its document and output routes.
10. Reject unmatched routes with 404, classify versioned parsing errors and render other errors through the shared document owner.

Document admission and versioned API admission share the captured-actor owner while retaining their different response
contracts. APIs and standalone outputs keep their explicit response owners. Missing compiled `/app` assets return
an uncached plain-text 404 before session or document handling so a loaded client can detect failed chunk delivery.


The explicit document router and versioned API expose these public route families:

```text
/          home
/api/v1    generated-contract API
/users     account, profile, dashboard, and OIDC routes

/survey    surveys
/packing   packing lists
/activity  activity plans
/drivers   drivers lists
/event     events and invoice pools
/help      in-app help
/guest     guest recovery and guest-account actions
```

Feature routers are not auto-discovered. Versioned adapters are mounted by `src/routes/api/v1.ts`.
`src/app.ts` mounts the domain routers explicitly. Each domain owns its document routes, parameter loaders and
exports. `src/routes/frontend.ts` contains shared admission, bootstrap, feedback and error helpers, without route
registrations; `src/routes/outputs.ts` shares authorized header-file delivery. Specific creation and capability
routes precede resource parameters, and the application 404 follows every domain mount.

Client route records use the same domain organization under `src/frontend/routes/`. Its index composes those
records explicitly, with the catch-all last. Application initialization imports that route owner rather than
mixing domain declarations with Router lifecycle and recovery code.


## Application layers

The codebase uses practical layers rather than a framework-enforced domain architecture. Its database service layer is organized as functional modules, not service classes.

### Routes

`src/routes/` defines URL shape, middleware order, request validation, controller invocation, redirects, and response
selection. Explicit document routes and versioned API routes use the owners described above. Protected print, PDF and
proof downloads retain controller authorization at their owning domain routes. Proof links use the Event domain;
the versioned API keeps its separate context-protected download operation.


Asynchronous handlers are wrapped with `asyncHandler` or `asyncParamHandler` from `src/modules/lib/asyncHandler.ts`, allowing the centralized error chain to handle rejected promises.

Canonical document routes admit each feature through its shared controller entry operation. Versioned feature
routers expose creation, duplication projections, guest entry and lifecycle commands through the same controller
owners. Standalone header images and exports retain their document output adapters. Surveys keep their own
participation/ownership model without joining the general permission system.

### Controllers

`src/controller/` contains request/response orchestration and feature-level normalization. Controllers commonly:

- normalize or validate posted values;
- enforce business rules and authorization, including checks against locked database snapshots, delegating complex feature logic to existing feature modules;
- call one or more service functions;
- build authorized page/SSR or API projections;
- choose flash messages, redirects, or expected errors; and
- coordinate file replacement or other cross-service actions.

Most feature controllers export a plain object of functions; other controllers use named function exports. Controllers do not instantiate class-based services and do not directly obtain TypeORM repositories.

### Database services

`src/modules/database/services/` is the pure database abstraction layer (DBAL). It exports repository queries, locks,
transactions, and persistence functions. Business rules, authorization decisions, and input checks belong to
controllers and their dedicated business modules. Services do not throw `APIError`, `ExpectedError`, or other errors tied to an HTTP/UI context.
Callers import the module namespace or named functions.

Multi-step writes that must be atomic use TypeORM transactions. A service-managed transaction can invoke a named
operation from the corresponding controller or its dedicated feature module with a manager and nullable locked rows.
That operation checks the snapshot and calls DBAL writes with the same manager. Controllers orchestrate request context,
feature operations, and service results; the controller layer decides whether absence,
conflicts, capacity, or lifecycle state should reject the operation. Native database failures propagate normally.

### Feature modularization and source ownership

Complex business logic belongs in the corresponding feature folder when that boundary improves maintainability,
as established by activity recommendations and `src/modules/invoice/`. Keep request orchestration in the existing
controller and pure persistence in the existing DBAL. Reuse coherent modules rather than introduce parallel services
or controllers. Re-exporting imported values, functions, or types is forbidden; consumers import their actual owner.

Every complex method requires method-level JSDoc **and internal comments explaining its meaningful steps in execution
order**. JSDoc does not satisfy the internal-comment requirement. Explain data flow, business constraints, locking,
state changes, side effects, and recovery where they occur. Pug mixins require equivalent unbuffered comments for
explicit inputs, conditional rendering, and browser hooks. The [Development Guide](DEVELOPMENT.md#readability-and-shared-contracts)
contains the shared authoring rules.

A central feature wording catalog is the single source for every relevant UI, accessibility, validation, notification,
and export string. Distributed strings are prohibited once that catalog exists. Stable keys, complete messages,
named parameters, and locale-aware plural forms preserve future localization without English sentence fragments.

Visual consistency is also a core acceptance criterion. Reuse the established application components, spacing,
typography, and interaction patterns throughout a feature. Exports follow the same rule: PDF sections use the shared
`sectionTitle` style and established document layout rather than feature-specific heading treatments.

### Entities, migrations, and subscribers

TypeORM entities are under `src/modules/database/entities/`, migrations under `src/migrations/`, and subscribers under `src/modules/database/subscribers/`.

`scripts/genTypeormIdx.ts` discovers these classes and generates `src/modules/database/__index__.ts`. That generated file is ignored by Git and consumed by both runtime and migration datasources. `npm run generate` runs before builds and the principal Vitest commands, but it must be run explicitly before standalone TypeORM commands on a clean clone.

The production datasource always uses `synchronize: false`. Empty disposable development databases and guarded
test/E2E setup retain their schema-synchronization workflows. For a confirmed empty production database that has
never held Surveyor data, follow the one-time [Database initialization procedure](DATABASE.md#initialize-a-new-empty-database).
Existing production schema evolution uses reviewed migrations; synchronization is not an upgrade tool.

### Middleware and error handling

Document and API admission use the captured-actor/session owner, followed by feature-owned page, method and private
projection checks. Shared permission middleware remains available for standalone outputs; each controller continues
to authorize its own operation. Versioned adapters validate generated inputs and encode structured `ApiProblem`
responses without exposing parser details or private submitted values.

Expected workflow failures keep their existing error contracts in `src/modules/lib/errors.ts`.
The canonical frontend router renders ordinary page errors as request-local Vue documents. The generic error
handler is a localized plain-text fallback that needs neither rendering nor a session and remains private/no-store;
API parse errors retain their JSON boundary. Controller operations, not route visibility or components, enforce
business policy.

## Identity and session architecture

Surveyor separates an authentication record from the profile acting in the application.

### Full accounts

A local `User` can own several `Profile` records. Local registration creates an inactive account, sends an activation token by email, and requires activation before login. Password reset also uses email tokens.

OIDC is implemented directly in `src/modules/oidc.ts`:

1. Discover the provider with `openid-client`.
2. Generate PKCE material and state for each authorization request; use a nonce when provider metadata requires the compatibility path.
3. Store transient values in the database-backed session.
4. Exchange and validate the authorization response at `/users/oidc/callback`.
5. Use ID-token claims and optional userinfo to find, link, or create the local user and profiles.
6. Persist the normal Surveyor session identity and tokens needed for provider logout.

Both local and OIDC users therefore enter the same local account/profile model after authentication.

### Guests

A guest has a private link token and one associated profile. Optional email enables recovery of guest links. Guest participation is persistent server state, not an anonymous browser-only session.

### Active profile

The session stores either a full user or guest authentication object plus the active `profile`. Ownership, participation, assignments, display names, permissions, and dashboard membership are evaluated against that profile. Maintainer changes must not substitute account IDs where a profile ID is required.

Sessions are stored in MariaDB through the `Session` entity. They expire after one day in both cookie and store configuration and are revalidated against current account/profile state on each request.

## Authorization architecture

The general permission system applies to events, activity plans, packing lists, and drivers lists. Surveys are an intentional exception with their own invitation and participation behavior.

For a non-owner, the permission engine combines every applicable grant:

```text
individual | public | authenticated | guest | participant
```

There are no deny records and no override hierarchy. Owners receive the complete permission mask. Item checks may include explicit parent-entity fallback permissions. Page admission, action permission, entity ownership, item ownership, event participation, and delegated administration are related but distinct checks.

The complete bit, preset, default, audience, persistence, and evaluation contracts are maintained in [Permission-System Reference](PERMISSIONS_REFERENCE.md). User-facing recipes are in [Permissions and Sharing](user-guide/en/PERMISSIONS.md).

## Domain architecture

### Surveys

Surveys primarily coordinate recurring monthly patterns represented by weekday plus first/second/third/fourth/last occurrence. Profiles submit Yes/Maybe/No answers. Every admitted participant may add a combination. Survey participation is link-based and survey-specific; there is no general permission matrix or event linkage.

### Events and invoice pools

Events own date boundaries, capacity, registration/deadline policy, dietary data, participants, linked activity/packing/drivers resources, and invoice pools. Invoice pools coordinate accepted costs, participant factors, takeovers, signed adjustments, shares, and recorded settlements. Read-only previews share the calculation logic with transactional recalculation. Closed-pool edits mark the saved calculation stale while payment recording remains available; recalculation carries previous payments/refunds as credits against new balances. Revision checks protect previews against concurrent input or settlement changes. Calculation snapshots support rollback of pool-local inputs without rewriting payment records or external event/invoice data. Configurable calculation notifications and later settlement emails use saved payment states. Proof files live on the filesystem while records and review history live in MariaDB. See [Development Guide](DEVELOPMENT.md#invoice-pool-calculation-and-saved-changes) for the arithmetic and rollback contract.

`eventPoolController.ts` orchestrates the invoice business modules in `src/modules/invoice/`, including calculation,
locked pool/invoice/coverage operations, request normalization, notifications, presentation, exports, and proof retention.
The existing `EventInvoiceService.ts` remains pure DBAL. Shared type-only contracts live in
`src/types/InvoicePoolTypes.d.ts`; no forwarding or barrel exports bridge old and new paths.

Pool lifecycle separates participant submission access from financial closure. OPEN allows participant invoices and
self-service takeovers; ORGANIZER_ONLY is displayed as **Organizer invoices only** and disables both participant actions.
These are independent pool states. Creation's **Invoice submissions** selector offers **Open for invoices** (the
existing default) or **Organizer invoices only**, so a pool can start directly in either state and close from either.
Organizers can move OPEN to ORGANIZER_ONLY with **Close participant invoices**, or ORGANIZER_ONLY to OPEN with
**Open participant invoices**, after frontend confirmation. The server checks event ownership, permission, revision, and lifecycle under
the pool lock. These transitions retain costs and allocation inputs without calculating shares. Either state can use
the existing **Close pool & calculate** workflow to become CLOSED. A calculated CLOSED pool never reopens through
submission-access controls. Organizer costs and invoice review remain available in all three states.

`wording.ts` and its locale catalog own shared email/PDF/export messages and the English source for generated Finance interface wording.
Vue interface projections use the shared generated translator. `presentation.ts` supplies the common
settlement-status rule. The primary saved **Calculated balance** stays visible after payment or refund. The compact
**Payment due**, **Refund due**, **Paid**, **Refunded**, and **No payment** statuses identify the named payer's situation.
Unsettled amounts determine aggregate unpaid transfers independently from the primary calculated balance.
Refunds remain negative in views, emails, and PDF exports.
The compact settlement buttons match the ledger's outlined actions. Confirmation is a frontend gate over the existing
command APIs; correction/retraction's existing revision contracts remain intact.

The pure shared `coverage.ts` owner normalizes applied coverage evidence, compares pending pairs, and computes actual
old-to-new deltas without renderer or persistence dependencies. `poolOperations.ts` imports it directly;
`presentation.ts` only exposes its helpers through renderer data, without re-exporting imports.
Organizer closed-pool takeover displays use applied coverage from `calculationSnapshot.takeovers`, including an authoritative empty
list, with saved contribution pairs as a fallback when only numeric provenance exists. Current takeover edits remain
separate **Pending takeover changes** when a known applied baseline differs.
The collapsed header and editable coverage group expose **Takeover changes pending** explicitly.
They do not rewrite saved shares or notify participants until recalculation succeeds. The locked calculation compares
the previously applied snapshot with the final committed coverage and returns only that delta for post-commit notices,
independently of the settlement-email preference. Planning changes before financial closure notify immediately;
pool-local rollback restores inputs silently. Before calculation, current planning inputs are known evidence. A CLOSED
legacy calculation without either frozen source has unknown applied coverage; it discloses that absence without
inventing a pending baseline or a historical notification delta. Editable planning inputs then appear under
**Takeovers for next calculation**. Rollback requires known saved coverage and rejects an incomplete snapshot before
writing inputs instead of guessing the previous responsibility.
Participant invoice and takeover pool choices remain OPEN-only. Their saved personal calculation explains any
applied coverage after closure; no additional closed-pool participant coverage listing is introduced.

Optional frozen `settledRegistrationIds` identify valid registrations with nonzero signed carried settlements in the
saved calculation. Preview and commit derive that same evidence from prior credits and newly recorded balances, never
from old IDs or dates alone. An exempt or covered former payer retains their own correcting share until the transfer
is settled and recalculation consumes its credit. When those signed transfers net to zero, a covered orphan row is
removed; an allocated exempt zero row remains ordinary, without the retained-settlement indicator or historical date.
The shared coverage policy resolves applied responsibility from frozen evidence only. Both ledgers, personal
breakdowns, emails and PDF notes use the central notice. Applied responsibility changes send an explicit notice after
commit independently of general calculation emails; optional bulk notices exclude those recipients to avoid duplicates.
No gross historical transfer amounts are inferred, and registration hard deletion retains its existing boundary.

Participant submissions are attributed to registrations and require proof. Organizers with `MANAGE_ASSIGNMENTS` can
also record immediately accepted costs in any pool state without their own event registration. Proof is optional
whether the organizer leaves **Paid by participant (optional)** at **No participant — shared pool expense** or selects
the participant who paid. The unassigned default contributes shared costs without personal invoice credit. A selected
registration must belong to both the event and the pool, checked by the named business operation under the root lock;
it reuses existing invoice-credit, own-history, receipt-access, and own-invoice Close behavior. Recorder attribution
remains independent of the selected payer. Its profile reference uses `SET NULL` on deletion while the recorded name
snapshot remains. Creation sends no email. Adding a cost to a closed pool invalidates the calculation without changing
its saved settlements. Organizer costs are external inputs to pool-local rollback and remain saved. Optional participant
attribution uses the existing registration relationship and requires no schema or migration change.

Accepted and Closed invoices can be corrected or rejected by an organizer after an explicit, revision-checked
confirmation. Original details and proof remain; corrections retain the existing accepted/closed status, while
retroactive rejection excludes the cost from future calculations. These changes invalidate closed pools and preserve
settlements until recalculation. Participants may retract only their own unreviewed invoice into the retained
RETRACTED state. Retraction advances the revision but does not change the stale flag because the cost was never counted.

Base-share rounding is a saved pool setting. Exact weighted cent ratios round every participant in the same direction
before takeovers are combined. Preview reconciliation reports the rounding surplus or shortfall and separates invoice
reimbursements and recorded settlements from gross costs.

The pool loader fetches child collections with TypeORM's query relation strategy in a `REPEATABLE READ` transaction,
keeping a consistent snapshot without a multiplying join. Writes retain locks and revision comparisons. Review and
settlement notifications start only after persistence; SMTP failures are logged separately from financial results.
Pool and preview overviews retain meaningful cost and transfer context. Closed pool headers preserve the full total
and both outstanding transfer totals. The global saved breakdown lists contextual calculation numbers only,
distinguishing invoice costs, the distributable base, and positive/negative adjustment modes, including opposing
adjustments whose net total is zero. It contains no formulas or explanatory prose. Fresh closed pools
with known saved cost provenance omit a duplicate current-source list; open, stale, and legacy pools retain applicable
current costs. Accepted-but-not-closed invoice costs remain available as review context. Saved settlement details
expose applicable invoice credits, prior credits, received payments, signed refunds paid, and rounding differences.
Current pool costs and saved settlement totals are explicitly distinguished when calculation inputs are stale.
Received/refunded totals refer only to transfers recorded in this calculation; carried settlement credits stay separate.
Share breakdowns and component columns omit unused amounts while retaining the primary calculated balance and status.

The organizer ledger searches and pages saved shares in the browser. Participants use the same responsive ledger
design across their own pool shares, with pool search, status filters, sorting, page sizes, pagination, and one reusable
read-only breakdown dialog. Personal explanations belong inside that dialog. Both dialog and settlement email show
the payer's concrete arithmetic, including every own and covered contribution under its saved name, applicable
adjustments and credits, and the final saved balance. Unrelated payers' names and contributions are excluded.
Exempt or zero-weight personal explanations omit the shared cost and divisor steps when no own or covered participant
has positive automatic weight. They retain each exemption or actual zero-weight input, fixed adjustments, credits,
and the saved final balance. Covering an eligible participant retains the relevant shared calculation context.
Settlement emails directly address their recipient outside the full explanation and immutable saved notes.
**Saved calculation notes** preserve the original `share.note` items, including names and authored descriptions, before
and outside the optional **Calculation explanation**. They are neither replaced with synthetic notes nor nested in a
second source-notes section. Used takeovers introduce their actual covered count and names before
the beneficiary calculations. Settlement emails keep the signed balance, status, context, and main action above
that secondary detail; one native HTML disclosure groups the complete calculation where the email client supports it.
Its contents remain in the message without author-level hiding, and plain text always includes every named equation
and note. Client-specific sanitization and disclosure support limit whether HTML can collapse. The organizer's
settlement-email dialog closes only after a successful server confirmation and completion of pending-state cleanup;
a failed or unconfirmed request leaves it open with feedback. The notification API remains unchanged.

The shared presentation owner keeps contextual source-data figures, arithmetic explanations, and immutable saved
facts separate. `invoicePoolCalculationBreakdown` returns the metrics-only `InvoiceCalculationOverview`: global saved
cost figures, used signed adjustment categories, and contextual assigned-participant, day/night, eligible-unit,
exemption, and total-weight metrics. This contract has no formulas, descriptions, or note items. Entirely missing
numeric inputs appear as **Saved calculation inputs: Not saved**. Legacy calculations retain known amounts and mark
an unprovable **Full pool total** as **Unavailable**, rather than inventing figures or explanatory paragraphs.
`invoicePoolCalculation` supplies **Example calculation**: saved total/base cost arithmetic and explanation first,
followed by a qualifying anonymous payer's arithmetic. Organizer views and previews place that example in a separate
collapsed disclosure alongside the figures-only **Calculation breakdown**. The authorized portrait A4 PDF includes
the example when requested. Both PDF variants retain contextual figures, saved shares, factual notes, status, dates,
and settlement totals. Without-example contains no generated explanations or formulas, including transfer-scope
paragraphs or a stale-calculation explanation; it uses the short **Recalculation required** label when needed.
**Full pool total** is invoice cost plus signed on-top adjustments; **Base to distribute** is the shared remainder after
redistributed adjustments. Redistribution changes who pays existing costs without changing the full total. Ordinary
pools without adjustments use one cost figure; only the example explains the equality of their cost scopes. Used
adjustment categories and relevant base/full scopes remain distinct even when their amounts coincide. Personal
explanations retain the self-contained pool figures needed for their own calculation while omitting an unrelated
full-pool-total equation. The example names attendance, share factor, and the divisor only where applicable and uses
saved values. Older snapshots never infer unavailable provenance from
current settings. Example selection uses supplied positive saved payer balances with an own, nonexempt contribution,
excluding covered participants, exempt payers, refunds, and zero balances. It prefers payers without beneficiaries,
then positive own weight within each coverage group, then an own redistributed surcharge before actual
factor/adjustment/credit feature richness, with saved registration identity as a stable tie-break. This surcharge
demonstrates both shared-base redistribution and the payer adjustment. A positive fixed balance with zero own weight
is a factual fallback.
An unavoidable covering example introduces the true number of other beneficiaries before its formulas. When no payer
qualifies, the example can still explain available saved pool-cost arithmetic without introducing a fictional payer.
Legacy numeric evidence discloses missing provenance honestly within that example. Entirely missing numeric
explanation data produces no example heading. The PDF exports every persisted share with current payment state,
using established section headings and, in the with-example variant, one full-width equation per row.
Its row notes keep saved facts and settlement dates without repeating calculated balances or each participant's
formula. The PDF's saved settlement summary preserves payments due and signed refunds due, applicable invoice and
prior credits, and signed transfers recorded in this calculation without inferring gross historical transactions.

### Activity plans

Activity plans contain dated slots, optional roles, assignments, shared fields, participant requirements, availability, recommendations, and review operations. The user guide owns the basic and advanced organizer workflows. [Activity Requirements and Assignment Recommendations](features/activity/ACTIVITY_REQUIREMENTS_ALGORITHM.md) is the canonical technical reference for precedence, coverage, fair allocation, bounded repair, overfill, background jobs, review states, and application persistence.

### Packing lists

Packing lists contain ordered shared item definitions and profile-backed assignments. **Everyone** rows bypass individual assignments. The personal **Packed?** state is browser-local and never reaches the server. Lists may be standalone or linked to events and use the general permission system.

### Drivers lists

A drivers-list row represents a ride offered by the profile that created it. Passenger assignments are separate. Capacity excludes the driver; list participant totals deduplicate assigned passenger profiles. Lists may be standalone or event-linked and use the general permission system.

### Users, guests, and profiles

Identity services manage activation, password reset, OIDC links, guest tokens/recovery, profile creation/default selection, profile migration, and deletion. Relationships throughout the collaboration domains use profiles as the human actor.

`src/modules/email.ts` owns message rendering and SMTP delivery. Its required named recipient contract provides a
Nodemailer Address object for the To header and a single personal greeting before the heading in both HTML and plain
text. Callers supply actual account, guest, or profile names. HTML text escaping and HTTP(S)-only action links apply
centrally to every notification. Shared email declarations live in `src/types/EmailTypes.d.ts`; callers import their
type owner directly. Optional section groups and leading primary actions reuse the existing renderer, while callers
without those options retain their established message layout.

## Frontend architecture

### Request-local rendering and initialization

`src/frontend/app/createApp.ts` constructs the same Vue tree for server rendering and browser hydration.
`src/modules/frontendRenderer.ts` is the existing Express renderer owner; it supplies authorized bootstrap data
and coherent built manifest assets without making HTTP calls to its own application. Each request owns its app,
router, QueryClient, locale instance and bootstrap. Private state never lives in a module singleton or persisted cache.

Public Home is `/` (`/home` remains an alias); personal Overview is `/users/dashboard`. Shell links, identity fallback and confirmed-removal delivery share the Overview
destination constant. Home renders its existing request-captured suggestion without reading personal collections.
Dashboard document and warm navigation share the native account-or-guest/profile Login journey. Missing authoritative
identity does not manufacture anonymous admission. Resource guest/admin intent follows canonical Router records and
explicit Express operation declarations, independently of equivalent case or trailing-slash URL spelling. Help route
metadata identifies article readiness and locale-URL synchronization without classifying unmatched paths as articles.

`serializeBootstrap.ts` escapes inert script-element JSON; `decodeBootstrap` validates every declared field before
reactive state is created. Feature validators load with their view. Shared type-only contracts remain `.d.ts` files.
Interactive initial content shows a shared page-family skeleton until client initialization succeeds. Route metadata
selects its decorative composition; scoped missing-data regions reuse the same field/card/table primitives inside
their existing layout. Presentation never reads private data, admits a command or invents actual record counts.
Readable results and Help retain genuinely functional static HTML, GET search, links and anchors. JavaScript-dependent
shell controls wait for initialization; an independent localized notice covers disabled, missing or failed JavaScript. Initial Vue error
capture covers setup, mount and the first readiness render; later feature failures retain their existing owners.

`mountPreservingDrafts` retains early edits on original admitted controls, with explicit opt-in for non-text/file
inputs. Startup protection exists before route loading and transfers to mounted owners after restoration. Automatic
reload additionally requires explicitly eligible dynamic route/content, clean state and a working loop marker.
Overview, Packing/Drivers/Survey/Activity detail and Event detail/admin opt in. Creation, duplication, user-management, Help and
static admitted errors/completions remain excluded. Route metadata and the existing content classifier feed the shared update owner without copied
field policy. The context consumes actor/visit-bound static predicates from mounted `usePageEntry` owners without
mirroring query data. Initial-bootstrap retirement does not retire a visible denial; fresh admission restores dynamic
eligibility, and owner/actor disposal releases classification. App, SSR and automatic recovery share this result.
Deliberate recovery retains draft consent and pending/unknown guards on every page. Recovery never
persists secrets/files or replays writes. Session/security revalidation and scoped reads remain separate.

### Shared contracts, state and commands

`contracts/api/v1/` owns wire schemas and operation policy. Generation emits declaration contracts and standalone
runtime validators; no second handwritten wire schema or runtime schema compilation exists. Transport adapters decode
and present around the same controller business owners. Page admission, method grants and private projections remain
separate; reusable controls never grant authority.

Generated local-input failures flow through the existing transport/command/feedback owners. Features supply visible
field and optional row/day labels; shared typed diagnostics retain only safe generated rule metadata and translate
at render time. Constraints remain in authored schemas and business checks in controllers. Matching creation and
duplicate permission matrices use `CreationPermissions`, a closed-by-default disclosure that keeps controls and
drafts mounted while the existing form retains submission and admission.

Express's ordinary `req.session` is the single request Session. Admission checks current stored generation without
adopting another snapshot; its plain hydrated actor captures identity for the operation. Initial session projection
and public rendering without feedback create no anonymous row/cookie and return null context/CSRF where none exists.
Existing authenticated records can project bounded legacy metadata without a write; explicit identity transitions retain their existing
completion owner. Browser claims/epochs/capabilities never grant authority. Controllers and stored server identity
remain authoritative, including public grant-only methods without an invented anonymous principal. An intentional
account-required document redirect retains native anonymous Session/flash persistence and one-time consumption,
without a URL notice or metadata initialization. Ordinary saves and native expiry/provider effects retain their
owners. The [Development guidance](DEVELOPMENT.md#backend-and-method-policy-contracts) describes these boundaries.

The [Development contract guidance](DEVELOPMENT.md#contract-authoring-and-generated-consumers) owns supported
schema/transport styles, strict generated validation and released-version compatibility. The shared translator and
catalogs currently serve UI/API text and reviewed Help; language preference is a browser cookie. Grammar supports
plain text/cardinal plurals and declared, validated component placeholders through the shared RichMessage owner;
scalar values stay escaped text and catalogs cannot supply HTML. Principal-language persistence and full localization
of email, PDF and other invoice output remain intended
future decisions in [DEC-006](decisions/DEC-006-FRONTEND-FRAMEWORK.md#deferred-localization-and-domain-integration-targets),
without an implemented production capability.

TanStack Query owns authorized snapshots; feature or shared interaction drafts own original/local/current values and Router owns URL state.
`app/queryKeys.ts` names actor/resource/filter families, adding locale only for translated representations.
`app/context.ts` coordinates identity generations, session admission, language and updates without another data store.
Ordinary session recovery pauses dispatch while readable content/drafts remain; actual actor retirement and validated
resource denial retire protected state. `useQueryAdmission` keeps each observer's eligibility bound to its logical key.
A canceled refetch or manual cache alias is not a fresh receipt; shared fresh-read helpers distinguish actual success.
`EntityEntryPage` dispatches denial retirement through that shared cache owner. Packing, Event, Drivers, Survey and Activity select
the affected query families; inactive copies retire without discarding a live creation draft. The producing admission family
survives inactive-family removal even when initialization or session revalidation pauses its observer, because that
query still owns the displayed denial. The shared component infers no feature permissions or query-key positions.

Healthy active shared reads use 30-second polling and bounded recovery, honoring Retry-After, hidden tabs and disposal.
Closed regions do not poll. Locale changes retire translated families only. `MetadataDraft` applies feature normalization
to dirty comparison and sparse submission; touched-current-value comparisons occur under existing locks. Finance
revisions and recommendation fingerprints retain their separate semantics. Confirmation acknowledges submitted values;
only a fresh admitted read restores tokens/grants. Failed follow-up remains saved; unknown delivery retains input and
explicit review without automatic replay.
A same-actor read pause does not retire a confirmed command. Preserve its returned result and failed-refresh warning
so the feature can release completed input; actual captured-actor retirement still retires the result.

Overview additionally derives the current Query's actual invalidation state through the shared query-cache owner.
Its region/card consumers pause archive, restore, automation, personal visibility and Delete controls/dispatch while
retaining readable cards and existing navigation/filter/paging/expansion/Refresh admission. This write-only boundary
also applies to failed background reads and locale invalidation, including prolonged recovery, without another
freshness store or deleted-entity registry.

`command.ts`, `pageEntry.ts` and `feedback.ts` share status, departure protection, canonical delivery and receipt-owned
messages. Pending/unknown status may outlive an editor without retaining its fields. Confirmed navigation retries
only its required reads and destination delivery, never the confirmed command. The frontend feedback owner manages
transient notice scheduling/cancellation; persistent conditions remain visible.

`useEntityRemoval` retains original whole-page discard approval only through the first delivery attempt. Later Retry
or another departure consults the same root draft guard again, including newer sibling edits or earlier unchanged
drafts. A failed delivery retains the confirmed result and selected-read/navigation receipt independently of consent.

`observePageNavigation` shares router subscriptions, latest pending destination and disposal across App, Header,
Overview and page-entry/confirmed-transition consumers, retaining each caller's URL boundary and callbacks.
The same navigation module coordinates Router scrolling with a mounted page's reactive render readiness. Help
exposes its existing admitted read/error and destination; Router remains the only anchor/history scroll owner.
This registration holds no article payload, query state or saved-position copy and cannot trigger a read.
Controls and feature drafts share an explicit value lifetime, including file release after confirmation.
`CommandFeedback` shares command receipt presentation across actual identity, Packing, Event, Drivers, Survey, Activity and Overview consumers;
`StatusNotice` presents actions with optional injected state and emits actions. Omitting state retains shared
`ActionButton` initialization and caller-handler guards. Features retain wording and recovery operations; durable
conditions remain in their meaningful context and transient notifications use the common page/dialog scope below.
These controls introduce no second receipt, query or draft owner.
`command.reconcileSafely` is the deliberate UI recovery boundary; causal command dependencies retain rejecting
fresh reads. `useSettingsAccessRetirement` shares selected editor-cache retirement and scoped recovery across all
five detail Settings consumers. Event admission/detail share one intent-specific denial-family selection, preserving
independent method grants and the producing observer's error/recovery state. Existing API transport functions share
upload completion, multipart decoding and confined stored-binary delivery across the five feature adapters; feature
admission, parser policy, cleanup and business operations remain with their existing owners.

Transient command notifications share page/dialog hosts supplied by `App` and `AppDialog`. Their sticky host
reserves the visible stack's natural height and releases it when empty, without scripted focus or scrolling.
The injected `noticeTargetKey` is a read-only presentation reference, not query, draft or authority state.
`CommandFeedback` chooses shared notification presentation; `StatusNotice` owns rendering, expiry, renewal,
dismissal and diagnostics. Durable validation/recovery stays contextual. Features do not recreate notice placement.
`composables/entityLifecycle.ts` supplies `createEntityLifecycle` to Settings, Overview and Event Things to do through
their existing API, command and current translator. It shares archive/restore confirmation, desired-state dispatch and
success wording. Settings, Overview and the Event child adapter share its pause/resume operation where the admitted
projection exposes an independent schedule; linked Activity has no independent automatic controls. Pause is immediate,
and resume asks for the existing elapsed-schedule confirmation. Callers retain eligibility, wording and refresh
lifetimes; the helper adds no state or backend business policy.

Event, Packing, Drivers, Survey and Activity detail adopt one displayed `EntityHeader`. Features supply the admitted title/icon, optional parent
URL, image operation/version/query key and settings availability. The header preserves the 250px cover image and
responsive parent tracks; Event's dashboard heading remains separate. It composes `useAuthorizedImage` and actual
successful query receipts. Receipt recovery waits for current props after rendering and checks the same resource/key
before consulting the image owner, so an admitted removal cannot recover old bytes. Parent destinations and feature
authority remain unchanged. Image upload editing remains the distinct `EntityHeaderEditor` responsibility.

`FormField` owns matching text/textarea labels and native controls. `FileField` composes its label/control slot for
creation and header-editing choosers, while the feature retains selected bytes, admission and command lifetime.
`EntityDescription` renders escaped read-only lines for Packing, Drivers, Surveys, Event and Activity. Explicit paragraph
hooks/classes and the optional native divider preserve list geometry; Event keeps its own labeled column and ordinary
paragraph margins. `EntityQuickAdd` shares Packing/Drivers card, description/capacity controls and submit layout while
features supply their distinct title controls, values and commands. The installed native number directive retains
coercion and DOM updates, including leading-zero normalization on change/rerender; feature drafts still hold a number
or remaining input text. No shared control stores another draft or grants authority.
`FormField` preserves native composition/caret handling, with an explicit lexical-number path for string drafts
and the existing native directive for intentional numeric normalization. Feature-owned parsing, constraints,
readonly state and explicit label content retain their existing meaning. The transport's
`createMultipartForm` shares creation/header serialization across all five entity features and the same Finance
proof envelope with an explicitly named binary part. It selects no operation, validates no second schema and
copies no file lifetime; required versus optional images/proofs remain with the feature.
The existing `usePageTitle` owner accepts catalog-owned complete journey titles when native prefixes or branding
differ from visible headings. SSR, initial hydration, warm navigation and locale changes consume that same owner.

Packing, Event, Drivers, Survey and Activity adopt `EntityEntryPage` for admission presentation, `EntitySettingsDialog` for settings composition
and `EntityMetadataEditor` for metadata draft/command reconciliation. Packing, Event, Drivers and Activity additionally adopt
`EntityAccessEditor` for audience/administrator interaction; standalone Surveys supply no Access operations.
Generated feature APIs, query families, field controls and normalization remain injected. Lower controls
and declaration contracts retain explicit data/events rather than infer feature authority. The shared identity
`GuestEntryPage` owns name/email, advisory lookup and confirmed/unknown identity completion for all five resource types;
each feature supplies its read, registration operation and exact return destination.
Their metadata field adapters expose the same mounted editor through `useMetadataEditorHandle`; its derived
flags and methods retain one underlying draft/command owner. Their nullable text fields use the existing
`metadataDraft.ts` normalizer, while Event capacity and deadline semantics remain feature-owned.

Event reads separate detail/admin intent, participant roster, link management, metadata and settings projections under
their existing grants. Detail includes own attendance and counts, with only a bounded invoice-presence flag; it does
not disclose a roster or finance aggregate. Registration alone spends a supplied bypass token. Event creation and
duplication use the ordinary generated multipart command and shared Vue creation/navigation owners, preserving
native preprocessing, upload, creation and permission initialization in their existing order. Event creation and the
`EntityListCreation` used by Packing, Drivers and Activity adopt `useCreationCommand`; Settings, Overview and Event-child deletion
adopt `useEntityRemoval`. Packing/Drivers also share `BasicEntityMetadataFields`, `useListDetail`, `useListReorder`,
`EntityAssignees` and `EntityAssignmentActions`, retaining Packing's checklist/Everyone behavior and Drivers' distinct
driver/passenger meanings in their feature owners. Activity also adopts `EntityAssignees`; its remove-control slot
preserves native spacing and data hooks under the shared disclosed-identity guard. `AppTabList` shares native tab
keyboard behavior and Reka focus ownership across Settings and Activity, while feature panels retain their lifetimes.
`AppAccordionButton` shares trigger presentation and initialized activation across matching Event, Overview and
administrator disclosures without owning open panels or reads. These shared Vue owners compose existing
command/consent/confirmed-navigation lifetimes, while features retain their fields and
generated operations. Packing/Drivers/Survey/Activity compose `useListCommands` from the existing detail-read owner for
cooldowns, explicit stale recovery, guarded post-command refresh and deliberate unknown-creation review. Features
inject their actual fresh read and dirty policy, including Survey's ballot merge; Packing/Drivers/Activity opt into their
common permission wording and shared denial notifications. The composition keeps no second snapshot/draft and never repeats a mutation.
`EntityListCounters` shares Packing/Drivers' admitted counter panel; `RefreshButton` supplies integrated Refresh
in the owning heading for entity details, Event administration, Finance, Help and profile workflows through each existing read owner.
`PageHeading` keeps entity and profile titles centered with independent parent navigation and actions.
Features retain admitted projections, cooldown and dirty-value policy; creation/static content invents no read.
`EntityDetailReadState` shares the list details' denied/stale/cold fragment and skeleton through explicit
state/timestamp props and optional contextual recovery; it owns no query or authority. `CommandFeedback`'s optional creation
review descriptor shares the unknown-creation paragraph/button while features retain eligibility, wording, margins
and the existing review operation.

Activity's basic components own dated slot drafts, local filters and warning-review intent. Existing `InlineCell`
owns inline values, comparison and conflict recovery; optional tag/multiline inputs change presentation only.
Its Enter/Ctrl+Enter handler leaves active text composition to the browser before preventing any default or saving.
Activity's distinct role input applies that same composition boundary before selecting/creating a role. Ordinary
shortcuts, blur and mouse actions retain their existing owners. This approved composition behavior supersedes
the historical native reference.
Active description flags retain that same editor through a remote empty value, and slot modals retain opening fields
while current permission loss disables submission. Client admission remains separate from server method grants.
The schedule badge derives the complete saved-slot total independently of local filters. One pure browser-safe
`civilDate.ts` owner supplies Activity creation and versioned detail weeks, plus matching Event/Activity date-only
display. Its structural declaration lives under `src/types/`; UTC calendar stepping and explicit UTC formatting
preserve the saved day while the selected locale controls wording. This approved presentation correction replaces
the original separate native browser/server algorithms without changing persistence, business calculations,
printable output or instant/deadline ownership.

`ActivityRequirements` owns its lexical settings draft and saved calculation context. It composes the existing
`ActivityParticipants` presentation with unsaved results from the shared pure requirements engine; ordinary reads
cannot overwrite dirty controls. Engine inputs are structural values, and the shared `RoundingMode` declaration
keeps browser compilation independent of ORM entity metadata without changing the database column or algorithm.
`ActivityRecommendations` owns local review rows, exact submitted batches and domain-job identity. Its schedule
and manual editor share feature presentation, while `ActivityWarnings` and the established dialog/command owners
retain warning acknowledgement, pending locks and recovery. Server snapshots remain in Query.

Recommendation entry, explicit Reload, explicit generation completion and confirmed application retain the existing
controller maintenance invocations through a deliberate command. Recovery uses a pure snapshot; job polling observes only
the captured domain job. Neither read path maintains rows or enqueues work. The existing Activity controller and
engines retain eligibility, provenance, reciprocal moves, collision privacy, application and inherited completion
behavior. Versioned projections select scalars, including former-participant override labels, and omit raw job diagnostics.

Versioned reads and guest identity completion cannot create an Event; the adapter does not strengthen inherited multi-step creation
finality. Ordinary profile workflow and Event child-deletion commands follow the same SPA transport boundary,
without importing their excluded backend repairs. Router owns ordinary migrated links; true provider/capability
arrivals and outputs retain explicit document ownership. Token issuance is deliberate
command work, never Query, prefetch or history restoration; private output stays in its admitted mounted lifetime.
Transfer/deactivation branches expose the same typed former-owner cleanup facts to native wording and generated
catalog notices. Account/guest deletion uses that notice path too. Vue retains message keys through the
existing completion/navigation/notice owners, so a visible confirmation reacts to language changes. No adapter
parses prose or repeats a cleanup decision; native wording and operation sequencing remain unchanged.
The controller's capacity predicate serves display and registration admission; its child-eligibility
predicate serves related projections and scoped lifecycle rechecks. DBAL supplies counts, rows, locks and
persistence rather than deciding either rule. Optional-session method declarations describe the existing public
grant boundary; they do not change runtime authentication or widen profile-required operations.

Participant notes dialogs retain only a summary or participant-ID selection. Displayed notes derive from the full
current admitted roster, independently of local search; removed sources close the selection. Organizer attendance
dates are genuine local drafts and remain separate from those read-only notes and background replacements.

Finance composes the admitted Event page with distinct participant/organizer projections, shared saved history,
totals, ledgers, coverage and lazy protected explanations. Independent pool, invoice-review, enrollment, factor,
adjustment and coverage forms retain their own lexical drafts and confirmed saved-field baselines through sibling
saves and failed follow-up reads. Matching controls use the shared `FormField` lexical-number option and the existing
finance wheel guard; intentionally normalized numeric consumers keep their existing binding. One Finance palette
supplies readable secondary text in the admitted region and shared dialogs, including dialogs rendered outside
their feature subtree.

Financial command money uses decimal strings retaining accepted precision; saved money uses the existing shared
fixed-two-decimal presenter. Factors and numeric identifiers retain their canonical decimal-string contracts.
Existing controller normalization, calculations and DBAL remain shared; Vue performs no replacement arithmetic.
Locale-owned Finance reads retire through the same query-family owner as Help and Overview without invalidating
untranslated Event snapshots. Pending uploads distinguish transferred bytes from saved confirmation; an unknown
outcome requires fresh history inspection and explicit acknowledgement without replay. Confirmed submission clears
completed invoice fields while retaining an eligible pool. Calculation, settlement and output operations keep their
existing domain boundaries and independent reviewed evidence.

### Entity settings

The existing `entityAdminController` supplies root field/method policy and authorized settings projections.
Feature controllers normalize input, and their existing services persist each property patch atomically.
App-owned components/composables host image, permission, administrator and archival commands through explicit
props/events and injected operations. Each section has its own draft and save boundary; pending writes freeze controls
and successful writes obtain fresh permissions/context. General, Linked event, Access, and Actions tabs appear only when
usable. Property families expand individually, and Access shows one audience or administrator editor at a time.
Feature composites remain separate where domain semantics differ. Packing, Event, Drivers, Survey and Activity use
`EntitySettingsDialog` for matching settings reads, independent drafts and captured tokens. It composes
`EntityMetadataEditor`, `EntityHeaderEditor` and `EntityLifecycleActions`; Packing, Event, Drivers and Activity additionally
supply `EntityAccessEditor` operations. Standalone Surveys supply neither Access nor event-association operations.
Features inject operations, query families, field policy and native wording; Packing, Drivers and Activity supply their
`EntityEventEditor` operations. Reka supplies dialog/tab focus behavior.
Mixed navigation uses the shared disclosure owner without competing Bootstrap DOM ownership. Shared timezone
controls retain feature-owned deadline meaning, including omission of unchanged instants.

Creation and later event linking use the actual submitted destination and the cumulative permission engine.
The permission engine supplies query scope for event discovery. `EventService` applies those supplied predicates
before the page limit; `eventController` rechecks effective attachment permission before returning options. The picker
replaces pages rather than accumulating DOM rows, preserves the selected event, and keeps bounded navigation history.
`EntityLifecycleService` locks old/new parents in deterministic order, then the child. Its controller callback checks
the expected relationship and authorizes the change while those locks remain held. Activity context changes invalidate generated
pending suggestions and jobs while preserving committed assignments, manual drafts, overrides, and review history.
Surveys remain standalone with owner-only property editing. No new schema is required.

### Profile overview

The dashboard keeps participation and administration separate, each with main and hidden regions. Its mixed card
grid represents an eligible linked plan or list through its event card only when that event independently belongs to
the same collection and region. Otherwise the child remains an ordinary card. Personal visibility never propagates
from the event to its children, and event membership never substitutes for a child's own participation or administration.

`UserService.getOverviewPages` composes the existing feature membership queries into a common SQL projection. It
applies lifecycle and personal placement, matches filters, maps children to eligible parent cards, and pages the
combined set before returning card data. Counts distinguish underlying entities from displayed cards. A
`REPEATABLE READ` snapshot covers page selection, totals, placement, and lifecycle inputs; the controller reuses that
snapshot for archival presentation and batches permission checks for actions and optional fallback parent context.
Only an event's `ACCESS_VIEW` grant allows new parent context on a child card.

Existing Overview adapters share controller normalization and these service reads. The versioned projection supplies
independent regions to `OverviewRegion`, `OverviewItems` and `OverviewCard`. Each loaded region renders at most one
page or enclosing event plus a child page; hidden regions load on opening. Enhanced navigation reads before history
commit, merges only its region into the latest URL and adopts server clamping. Failure preserves cards, URL and focus;
validated denial retires private cards and source-owned totals. Ordinary modified clicks retain their href.
Shared event **Things to do** retains its local filtering and ungrouped membership semantics.

### Browser builds and shared assets

Vue application code lives under `src/frontend/`. Feature `api.ts` owners consume generated operations/validators
through `app/transport.ts`; app-owned controls receive explicit values, capabilities, events and injected operations.
Application presentation helpers and styles belong under `src/frontend/`, shared by their actual consumers.
The client entry and development renderer reference the same authored `styles/application.sass` root. It owns the
cascade once: Bootstrap Icons CSS, base `style.sass`, `help.sass`, then `frontend.css`. `style.sass` owns its
accordion/timezone imports, including the installed Bootstrap layer. Icon fonts enter the same authored build graph.
Vite emits separate client/SSR artifacts; the existing renderer uses the source stylesheet link in development
and the client manifest in installed releases, including styled server-rendered/static content before JavaScript
initialization. Serve application-owned browser assets from the instance's origin, including Bootstrap CSS,
icons and fonts, without CDN fetches. Preserve effective stylesheet order and styled pre-JavaScript content.
Responsive overrides belong in the shared authored presentation owner; generated output is never an authored source.

The [approved 2026-10-26 amendment](decisions/DEC-006-FRONTEND-FRAMEWORK.md#approved-local-browser-assets-and-responsiveness-scope-2026-10-26)
supersedes the earlier preservation of both CDN and compiled Bootstrap layers. The
[Development Guide](DEVELOPMENT.md#responsiveness-targets-and-evidence) owns the internal one-second optimization
target and established production responsiveness criteria.

The frontend feedback owner supplies notice lifetime; existing backend/domain/catalog owners remain shared.
Logo/favicon image assets and third-party Bootstrap/icons retain their real consumers independently of application
presentation code. Express-hosted Vite middleware supplies development HMR; production uses coherent built artifacts.

## Persistence and lifecycle boundaries

### Entity archival and personal visibility

Archival organizes the five root entity types without changing their existing access or mutation rules. Direct archival is `BaseEntity.archivedAt`; linked activity plans, packing lists, and drivers lists also inherit their event's state. Nested records follow their enclosing root. An event transition requires one event write, without copying state to every child. Restoration preserves independently archived children and pauses independent automation on dated roots.

The implementation keeps these responsibilities separate:

| Boundary | Responsibility |
|---|---|
| `modules/archive/policy.ts` | Pure UTC cutoff, effective-state, and personal-placement rules. |
| `database/services/EntityLifecycleService.ts` | Root and parent reads, coherent raw snapshots, lifecycle writes, conditional automatic updates, and transaction locks. |
| Existing `database/services/UserService.ts` and feature services | Visibility preference persistence, membership queries, and bounded overview queries; feature services own the shared SQL membership predicates. |
| Existing `controller/entityAdminController.ts` and versioned adapters | Lifecycle validation and authorization, effective-state and scheduling projection, presentation capabilities and generated API transport. |
| Existing `controller/userController.ts` | Personal visibility validation and membership decisions under the service-managed lock, overview navigation normalization, and bounded presentation. |
| `modules/entityArchival.ts` | Independent startup/hourly scheduling and local overlap prevention. |
| App-owned lifecycle/card controls and feature query owners | Server-calculated state, bounded navigation, explicit commands and authorized refresh after success. |

Overview membership is discovered before archival placement. Direct and parent state are resolved once per distinct reference in a `REPEATABLE READ` snapshot and reused across participation/administration cards. Personal `hidden` and `shown` overrides belong to the active profile; no preference means default placement. They never enter shared entity serialization or the event's **Things to do** filtering. Creation and settings event pickers include authorized historical and archived events by default, with explicit date, archive, period, and registration-deadline filters.

Optional lifecycle presentation travels through explicit component data/events and the owning controller projection. Shared contracts
live in `types/ArchiveTypes.d.ts`; repository dispatch and lock implementation stay inside the persistence boundary.
These responsibilities extend the existing administration and user modules instead of adding parallel controller or
preference-service layers.

Archival never calls deletion, proof/image removal, invoice retention, or financial recalculation. File retention and deliberate deletion retain their own lifecycles. Schema and locking details are in [Database and Migrations](DATABASE.md#entity-archival-state); the settings and inclusive UTC schedule are defined in [Configuration](CONFIGURATION.md#automatic-entity-archival).

Only events and standalone activity plans have independent automatic schedules. Linked activities follow the event;
packing/drivers lists inherit their event and surveys are standalone. Restoring a parent preserves independently
archived children and personal preferences. A child cannot restore through an archived parent. Date/delay changes
do not restore roots or clear pauses; disabling automation stops future automatic writes only. New/duplicated roots
start directly active and unpaused, inherit a selected event immediately, and copy no personal preferences.

The startup/hourly job captures one time per bounded sweep, repeats current direct-state/pause/date/standalone
predicates in each write, counts committed transitions and prevents local overlapping runs. Duplicate sweeps are
harmless; this remains the documented single-process schedule. Restoration cannot recreate files or business records
independently removed by retention or deliberate deletion. Detailed managerial archival context belongs to authorized
Entity settings; shared feature pages/cards show only the minimal archived condition.

### Other durable state

Surveyor's durable state spans more than the database:

| State | Location | Lifecycle concern |
|---|---|---|
| Domain entities, profiles, permissions, tokens, reviews, sessions | MariaDB | Migrations, transaction safety, database backup |
| Header images | `HEADER_IMG_DIR` | Shared/persistent filesystem and paired backup |
| Invoice proofs | `INVOICE_DIR` | Sensitive persistent filesystem, paired backup, retention |
| Configuration and secrets | CSV/environment outside the release | Protected deployment input and recovery material |
| Personal packing check marks | Browser local storage | Deliberately local and not recoverable by the server |

`startInvoiceRetentionJob()` runs cleanup once during startup and then hourly. The invoice feature's `retention.ts` and `proofs.ts` modules evaluate
the configured retention cutoff and proof-file policy, while the invoice DBAL selects and deletes expired records
and refreshes stored totals under pool locks. This in-process schedule is part of the single-process assumption.

The fixed help source is `docs/user-guide/`, packaged with each release. It is trusted application content, not a user-uploaded documentation store. The detailed trust and future-change boundary is recorded in [DEC-004](decisions/DEC-004-HELP-MARKDOWN-TRUST-MODEL.md).

## Build and release architecture

`npm run build` performs four groups of work:

1. Clean the repository-owned `dist/` output so retired assets cannot remain in a release.

2. Generate the TypeORM index, API contracts and locale consumers, then compile server TypeScript to `dist/`.
3. Compile Vite client/SSR output with separate Vue-aware compiler scopes, then compile the standalone print stylesheet.

4. Copy shared images, the print stylesheet and the two standalone Pug print templates into `dist/`.


The manual release workflow first invokes full CI on the selected ref. It then validates and commits the requested version, creates a tag, builds, and produces a tar archive containing:

```text
dist/
docs/
fonts/
package.json          production-only dependency manifest
package-lock.json
.npmrc                omits development dependencies
```

The runtime archive does not include TypeScript source or migration tooling and does not migrate the database automatically. Operators retain a source workspace at the matching tag for migration commands. Runtime archive, source tag, schema, configuration, MariaDB data, and uploads are treated as one release/recovery unit.

## Testing architecture

Vitest discovers unit, frontend and integration files. Its database-free project uses bounded workers for isolated
logic/client checks and scoped server-component integration. The database-backed integration project
remains serialized because it rebuilds one guarded disposable MariaDB schema. Test layer describes the exercised
production boundary; the database-free runner selection does not turn a real server-component integration into a
unit/client test. The [Testing Guide](TESTING_GUIDE.md#vitest-configuration) owns exact selection and commands.

Playwright E2E initializes its database and owns the built server without existing-server reuse. Isolated built-browser
checks use `playwright.frontend.config.ts`; source-server/persistence checks use the integration runner. Factories under
`tests/factories/` supply production-shaped data, with workflows in `tests/keywords/` and setup in `tests/support/`.

The layer contracts, setup files, database safeguards, command matrix, and examples are canonical in [Testing Guide](TESTING_GUIDE.md). Do not maintain test counts in architecture prose; the repository tree and runner configurations are the source of truth.

## Change-impact checklist

Before merging a change, trace it across the boundaries it affects:

1. **Configuration:** setting key, precedence, reference documentation, operator impact.
2. **Database:** entity, generated index, migration, transaction, backup/rollback implications.
3. **HTTP:** route mount, middleware order, validation, controller, error response.
4. **Identity:** account versus profile identifier, guest behavior, session invalidation.
5. **Authorization:** page admission, action permission, ownership, item fallback, survey exception.
6. **Files:** database record and filesystem operation remain consistent on success and failure.
7. **Frontend:** component/control, scoped query, separate draft, generated asset, SSR/initialization and static behavior.
8. **Tests:** cheapest stable layer plus integration/E2E coverage for cross-boundary behavior.
9. **Documentation:** user, maintainer, operator, and AI instructions remain aligned with the implemented contract.

## In-app help delivery

The in-app help subsystem is intentionally separate from mutable application data:

1. `src/controller/helpController.ts` selects reviewed articles and adjacent assets inside the fixed `docs/user-guide/` tree, using the shared catalog's supported corpus mapping.
2. A fixed task-group map orders the guides. The same catalog drives the sidebar and server-side search.
3. Markdown is checked against the DEC-004 authoring contract, converted with Marked, given stable heading IDs, and returned with a level-two/level-three table of contents.
4. Existing Help adapters map logical topics and assets to their declared routes. Path-containment and filename checks prevent request-controlled traversal; requests never choose a filesystem root.
5. Application requests receive a contextual `helpUrl`; the navbar therefore opens the guide for the current feature while retaining `/help` as the fallback.
6. The release workflow attempts to copy and compare the entire user-guide tree, including images, in a separate advisory step. A mismatch or missing documentation is reported without blocking release.

The renderer inserts validated, release-shipped HTML into the Help component. Prefer complete localized articles;
missing corpora/articles/required figures select the complete reviewed English article and its own assets, with visible
fallback and actual content-language disclosure. Never mix translated prose with English figures; invalid existing
source fails rather than hiding behind fallback. This trusted-content boundary is not a generic sanitization service.
Changing the source model requires reopening DEC-004.

### Documentation reporting is outside application delivery

The required CI workflow runs application checks only. `scripts/report-documentation.mjs` is an optional maintainer
entry point: structural and help-authoring diagnostics, actual-guide content tests, and tooling regressions are
advisory, with real findings and subprocess exits preserved in reports. The corpus-dependent suites are isolated in
`tests/documentation/`; the required help tests use synthetic renderer fixtures and application-only route assertions.
The release copies and compares documentation in a separate non-blocking step. A missing guide, stale fingerprint,
wording mismatch, or unavailable documentation checker cannot stop CI, builds, merges, or release. Runtime content
rejection remains active; see [Documentation Policy](policies/DOCUMENTATION_POLICY.md).
