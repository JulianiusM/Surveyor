# Surveyor Architecture
<!--
documentation-metadata
audience: maintainers; developers; AI agents
owner: architecture maintainers
status: current
last-verified: 2026-10-04
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: optional organizer participant attribution with independent recorder audit and existing credit/history/proof ownership; unchanged original saved notes before the email calculation disclosure; figures-only typed global calculation breakdown, total/base and optional anonymous payer steps inside a separate example, explanation-free compact PDF, success-only settlement-email dialog closure, and fresh-summary source deduplication; completed correcting-transfer cleanup, direct participant email wording, shared PDF pool-cost explanation, independent overview example disclosure and consistent exemption captions; active paid/refunded payer identity and applied responsibility notices; restored role-specific balance captions; explicit pending-coverage indicators; contextual full pool totals and shares export labels; pure shared coverage evidence owner, unknown legacy baselines and direct-import boundaries; established visual-component reuse and shared PDF sectionTitle; deterministic positive anonymous example selection, honest covering introductions and missing-evidence fallbacks; abbreviated exempt and zero-weight personal explanations; applied versus pending closed takeovers, post-recalculation delta notices and silent rollback; independent OPEN and ORGANIZER_ONLY initial states, default OPEN creation with Invoice submissions choice, reversible participant submission access with confirmation and revision checks, permanent financial closure, and guarded organizer-only migration; notes-first settlement emails with client-dependent native calculation disclosure, complete plain-text content, and opt-in leading actions; covered-participant count/name summaries; Payment due wording; structured anonymous pool examples in preview, organizer details and PDF; concrete complete payer explanations in dialogs and emails, separated from factual notes; cross-pool personal share ledger with one reusable read-only dialog; contextual current-source and saved-settlement totals; explicitly named attendance/factor/weight inputs; adaptive signed adjustment-category provenance and component displays; retained collect/refund totals; compact settlement statuses, nonrepeated PDF row details, and required PDF visual verification; invoice feature-folder orchestration, mandatory JSDoc plus internal step comments, catalog-owned localization-ready messages, prohibition of imported re-exports, calculated-balance-first settlement presentation, and compact payment/refund actions; responsive shares, saved numeric calculation provenance, signed settlement trace, frontend confirmation gates, and controller-owned invoice business operations; explicit controller-owned checks and pure DBAL/no context-specific service errors; implemented permission-filtered entity settings, atomic property updates, authorized event discovery/reassociation, and activity context preservation; source review of bounded mixed-card overview queries, event sub-views, shared membership and lifecycle projections, and fragment navigation; consolidated lifecycle and existing administration/user module boundaries; archival source-boundary, inheritance, overview-identity, and startup review; invoice correction and retraction lifecycles, refreshed submission history, and takeover overview dialogs; organizer-entered shared costs, repeat invoice submissions, visible payment feedback, and share breakdown dialogs; central named mail delivery and alert lifecycle, consistent pool relation snapshots, post-commit notifications, and saved-share PDF export; consistent per-participant rounding, reconciliation totals, and long takeover-list layout; invoice factors, preview/commit calculation projection, cumulative settled credits, rollback snapshots, and settlement notification boundaries; non-blocking documentation policy and optional report/test routing; D12 runtime, layer, authentication, authorization, persistence, frontend, background-job, build, release, and testing architecture plus D08 advanced activity requirement, allocation, job, review, and persistence boundaries; help integration remains assigned to D14; D14 fixed-source help search, contextual routing, Markdown validation, local visual assets, and release boundary
source-anchors: tests/e2e/invoice-organizer-expenses.spec.ts; tests/integration/organizer-invoices.spec.ts; tests/frontend/invoice-organizer-attribution.spec.ts; src/modules/invoice/settlements.ts; src/modules/invoice/coverage.ts; src/migrations/1790985600000-AddInvoicePoolOrganizerOnlyState.ts; src/modules/invoice/takeovers.ts; tests/unit/invoice-presentation.spec.ts; src/modules/invoice/wording.ts; src/modules/invoice/locales/en.ts; src/modules/invoice/calculation.ts; src/modules/invoice/poolOperations.ts; src/modules/invoice/invoiceOperations.ts; src/modules/invoice/notifications.ts; src/modules/invoice/requests.ts; src/modules/invoice/proofs.ts; src/modules/invoice/exports.ts; src/modules/invoice/presentation.ts; src/types/InvoicePoolTypes.d.ts; src/types/EmailTypes.d.ts; src/types/EntityPropertyTypes.d.ts; src/public/js/modules/entity-properties.ts; src/views/modules/module_entity_properties.pug; tests/integration/entity-properties.spec.ts; tests/integration/activity-property-integrity.spec.ts; tests/e2e/entity-properties.spec.ts; src/types/UserTypes.d.ts; src/modules/renderer.ts; src/routes/api/users.ts; src/views/modules/module_unified_entity_cards.pug; src/public/js/modules/entity-cards-overview.ts; src/public/js/modules/entity-archive.ts; src/modules/database/services/EntityLifecycleService.ts; src/modules/database/services/UserService.ts; src/controller/entityAdminController.ts; src/controller/userController.ts; src/middleware/adminApiFactory.ts; src/types/ArchiveTypes.d.ts; src/modules/archive/policy.ts; src/modules/entityArchival.ts; src/migrations/1789689600000-AddInvoiceRetraction.ts; src/migrations/1789603200000-AddOrganizerInvoices.ts; src/modules/email.ts; src/public/js/shared/alerts.ts; src/public/js/notifications.ts; src/routes/event.ts; src/modules/lib/pdf.ts; src/migrations/1789516800000-AddInvoiceShareRounding.ts; src/modules/invoice/settlementEmail.ts; src/migrations/1789430400000-AddInvoiceSettlementSnapshots.ts; src/modules/invoice/distribution.ts; package.json; package-lock.json; src/server.ts; src/app.ts; src/routes/; src/controller/; src/middleware/; src/modules/database/; src/modules/activity/requirements.ts; src/modules/activity/fairAssignment.ts; src/modules/activity/recommendationJobs.ts; src/modules/oidc.ts; src/modules/settings.ts; src/modules/permissionEngine.ts; src/modules/invoice/retention.ts; src/public/js/; src/views/; migrationDataSource.ts; scripts/runMigration.ts; scripts/genTypeormIdx.ts; esbuild.client.js; vitest.config.mts; playwright.config.ts; tests/; .github/workflows/ci.yml; .github/workflows/release.yml; src/controller/helpController.ts; src/routes/help.ts; src/views/help.pug; scripts/check-help-documentation.mjs; docs/HELP_VISUALS.md
next-review: architecture-or-help-delivery-change
-->

Surveyor is a TypeScript monolith that serves HTML and JSON from one Express process. MariaDB stores application records and sessions; the filesystem stores uploaded header images and invoice proofs. Pug renders the primary UI, with focused browser-side TypeScript enhancing interactive pages.

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
  |-- Pug HTML and static assets
  |-- JSON API under /api
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
| Language | TypeScript targeting ES2024 |
| Web framework | Express 5.2.x |
| Templates and UI | Pug 3, Bootstrap 5.3, Sass, browser TypeScript |
| Browser build | esbuild |
| Persistence | TypeORM 1.1.x with MariaDB/MySQL driver support; MariaDB 10.11 is the tested workflow baseline |
| Sessions | `express-session` with `connect-typeorm` and the `Session` entity |
| Input validation | Joi and `express-validator`, according to the route or workflow |
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
6. An HTTP server listens on the configured application port.

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
3. Install request logging, JSON and URL-encoded parsing, cookies, and static-file serving.
4. Create a one-day database-backed session with secure cookies in production and `SameSite=Lax`.
5. Enable one trusted proxy hop so secure cookies work behind the documented reverse proxy.
6. Install flash messages.
7. Validate the stored user/guest/profile session on every request; invalid sessions are logged out.
8. Populate common Pug locals, including the active profile, authentication state, version, selected public settings, and return URL.
9. Mount page and API routers.
10. Expose `GET /healthz`, then the 404 and generic error handlers.

Top-level mounts are explicit in `src/app.ts`:

```text
/          home
/api       JSON/API actions
/users     account, profile, dashboard, and OIDC routes
/survey    surveys
/packing   packing lists
/activity  activity plans
/drivers   drivers lists
/event     events and invoice pools
/help      in-app help
/guest     guest recovery and guest-account actions
```

Feature routers are not auto-discovered. A new top-level router must be imported and mounted deliberately. API subrouters are mounted separately in `src/routes/api.ts`.

## Application layers

The codebase uses practical layers rather than a framework-enforced domain architecture. Its database service layer is organized as functional modules, not service classes.

### Routes

`src/routes/` defines URL shape, middleware order, request validation, controller invocation, redirects, and response selection. Page routes use `express.Router`; API routes live under `src/routes/api/` and are mounted by `src/routes/api.ts`.

Asynchronous handlers are wrapped with `asyncHandler` or `asyncParamHandler` from `src/modules/lib/asyncHandler.ts`, allowing the centralized error chain to handle rejected promises.

Several entity types use `createGuestFlowRouter` from `src/middleware/guestFlowFactory.ts` for their common create, view, duplicate, delete, header-image, guest-entry, and event-linking flow. Surveys deliberately reuse that navigation flow without joining the general permission system.

### Controllers

`src/controller/` contains request/response orchestration and feature-level normalization. Controllers commonly:

- normalize or validate posted values;
- enforce business rules and authorization, including checks against locked database snapshots, delegating complex feature logic to existing feature modules;
- call one or more service functions;
- build data for a Pug view or API response;
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

The production datasource always uses `synchronize: false`. Schema synchronization is reserved for empty disposable development databases and the guarded test/E2E setup. Production schema evolution uses reviewed migrations.

### Middleware and error handling

Current authentication and authorization middleware is implemented in `src/middleware/permissionMiddleware.ts`. Important functions include:

- `isAuthenticated` for full user accounts;
- `isGuest` for guest-backed sessions;
- `isLoggedIn` for either authenticated form;
- `requireOwner` for entity ownership;
- `requireEventParticipant` for event-registration admission;
- `requirePermission` and `requireItemPermission` for entity or item actions; and
- optional/API variants and permission-bundle attachment helpers for rendering and JSON routes.

Shared assignment behavior is assembled by `src/middleware/assignFlowFactory.ts`. Entity administration is assembled by `src/middleware/adminApiFactory.ts` and related controllers.

Expected workflow failures use the custom errors in `src/modules/lib/errors.ts`. `ValidationError` can re-render a form with data; `ExpectedError` represents a user-facing failure; `APIError` carries structured API status/data. Page requests terminate in `handleGenericError`; API requests use the validation and wrapping chain mounted by `src/routes/api.ts`.

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

The complete bit, preset, default, audience, persistence, and evaluation contracts are maintained in [Permission-System Reference](PERMISSIONS_REFERENCE.md). User-facing recipes are in [Permissions and Sharing](user-guide/PERMISSIONS.md).

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

`wording.ts` and its locale catalog own the feature's complete messages. `presentation.ts` supplies the common
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

Activity plans contain dated slots, optional roles, assignments, shared fields, participant requirements, availability, recommendations, and review operations. The user guide owns the basic and advanced organizer workflows. [Activity Requirements and Assignment Recommendations](ACTIVITY_REQUIREMENTS_ALGORITHM.md) is the canonical technical reference for precedence, coverage, fair allocation, bounded repair, overfill, background jobs, review states, and application persistence.

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

### Server-rendered pages

Pug templates under `src/views/` render the primary HTML. Shared layout and module templates provide navigation, entity headers, permissions, cards, forms, and administration controls.

Page rendering uses `src/modules/renderer.ts` to pass consistent status, message, and data objects. Flash messages cover redirect-based workflows.

The shared layout always loads `notifications.ts`, including pages with their own script blocks. Transient alerts are
observed centrally and expire ten seconds after insertion or renewal. Persistent warnings and active progress use
status semantics and remain visible. Pool actions lock relevant controls during a request, report a delayed status
after five seconds, and change the displayed saved state only after server confirmation.
Payment feedback sits outside the filtered share rows; detailed saved share components open in a separate dialog.
Takeover summaries use name badges and a button opening a searchable Bootstrap dialog for the complete coverage list.
Confirmed participant submissions clear invoice-specific inputs and refresh the page to reopened history, retaining
the available pool selection for the next upload. Inputs remain locked during the refresh; pending and uncertain
uploads remain protected against duplicate submission.

### Entity settings

The five root views and event dashboard use `module_entity_properties.pug`. The existing
`entityAdminController` builds `data.entityProperties` from the same field policy used to authorize property writes.
Feature controllers normalize input, and their existing services persist each property patch atomically.
The browser dialog hosts the existing image, permission, administrator, and archival commands through shared UI
helpers. Each section has its own draft and save boundary; pending writes freeze controls and successful writes
refresh server-rendered permissions and context. General, Linked event, Access, and Actions tabs appear only when
usable. Property families expand individually, and Access shows one audience or administrator editor at a time.
Inline event, time-zone, and administrator controls avoid nested modals; time-zone search, common choices, browser
detection, and UTC offsets remain shared between inline and standalone hosts.

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

`/users/dashboard` and `GET /api/users/overview` share controller normalization and these service reads. The API
returns Pug-rendered region HTML in the established JSON envelope, with private, noncacheable responses. Ordinary
links and search forms retain full-page navigation. Each loaded region renders at most one page or one enclosing
event card plus a child page; hidden regions load when opened. Browser navigation replaces that region's content,
preserves namespaced URL state, and rejects stale responses. Shared event **Things to do** retains its existing local
filtering and ungrouped cards.

### Browser TypeScript

Browser code lives under `src/public/js/`:

- `core/` contains shared HTTP, form, navigation, permission, and DOM helpers;
- `shared/` contains reusable page behaviors; and
- feature modules/page entry files implement survey, event, activity, packing, drivers, and account interactions.

`esbuild.client.js` discovers every `.ts` file recursively and emits a corresponding `.gen.js` ES module while preserving the directory layout. Development output is written beside the source and ignored by Git; production output goes to `dist/public/js/`. Relative extensionless imports are rewritten to generated module names.

Sass sources under `src/public/style/` compile to ignored CSS before production assets are copied to `dist/public/`. Pug templates and image/style assets are copied as part of `npm run build`.

## Persistence and lifecycle boundaries

### Entity archival and personal visibility

Archival organizes the five root entity types without changing their existing access or mutation rules. Direct archival is `BaseEntity.archivedAt`; linked activity plans, packing lists, and drivers lists also inherit their event's state. Nested records follow their enclosing root. An event transition requires one event write, without copying state to every child. Restoration preserves independently archived children and pauses independent automation on dated roots.

The implementation keeps these responsibilities separate:

| Boundary | Responsibility |
|---|---|
| `modules/archive/policy.ts` | Pure UTC cutoff, effective-state, and personal-placement rules. |
| `database/services/EntityLifecycleService.ts` | Root and parent reads, coherent raw snapshots, lifecycle writes, conditional automatic updates, and transaction locks. |
| Existing `database/services/UserService.ts` and feature services | Visibility preference persistence, membership queries, and bounded overview queries; feature services own the shared SQL membership predicates. |
| Existing `controller/entityAdminController.ts` and `middleware/adminApiFactory.ts` | Lifecycle validation and authorization, effective-state and scheduling projection, presentation capabilities, and API registration. |
| Existing `controller/userController.ts` | Personal visibility validation and membership decisions under the service-managed lock, overview navigation normalization, and bounded presentation. |
| `modules/entityArchival.ts` | Independent startup/hourly scheduling and local overlap prevention. |
| Shared archive/card Pug mixins and browser modules | Server-calculated state, bounded overview/sub-view navigation, explicit commands, and refresh after success. |

Overview membership is discovered before archival placement. Direct and parent state are resolved once per distinct reference in a `REPEATABLE READ` snapshot and reused across participation/administration cards. Personal `hidden` and `shown` overrides belong to the active profile; no preference means default placement. They never enter shared entity serialization or the event's **Things to do** filtering. Creation and settings event pickers include authorized historical and archived events by default, with explicit date, archive, period, and registration-deadline filters.

Optional lifecycle notices travel with the renderer's page data and explicit Pug mixin arguments. Shared contracts
live in `types/ArchiveTypes.d.ts`; repository dispatch and lock implementation stay inside the persistence boundary.
These responsibilities extend the existing administration and user modules instead of adding parallel controller or
preference-service layers.

Archival never calls deletion, proof/image removal, invoice retention, or financial recalculation. File retention and deliberate deletion retain their own lifecycles. Schema and locking details are in [Database and Migrations](DATABASE.md#entity-archival-state); the settings and inclusive UTC schedule are defined in [Configuration](CONFIGURATION.md#automatic-entity-archival).

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

1. Compile Sass.
2. Generate the TypeORM index and compile server TypeScript to `dist/`.
3. Compile browser TypeScript to `dist/public/js/`.
4. Copy static image/style assets and Pug views into `dist/`.

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

Vitest discovers `tests/unit/`, `tests/frontend/`, and `tests/integration/`. It runs them in the Node environment with file-level parallelism disabled because integration suites share a guarded disposable MariaDB schema.

Playwright discovers `tests/e2e/`, runs Chromium, initializes the E2E database, and starts the built server through its managed `webServer` command. Factories under `tests/factories/` build production-shaped inputs; reusable workflow/assertion helpers live under `tests/keywords/`; runner and database setup live under `tests/support/`.

The layer contracts, setup files, database safeguards, command matrix, and examples are canonical in [Testing Guide](TESTING_GUIDE.md). Do not maintain test counts in architecture prose; the repository tree and runner configurations are the source of truth.

## Change-impact checklist

Before merging a change, trace it across the boundaries it affects:

1. **Configuration:** setting key, precedence, reference documentation, operator impact.
2. **Database:** entity, generated index, migration, transaction, backup/rollback implications.
3. **HTTP:** route mount, middleware order, validation, controller, error response.
4. **Identity:** account versus profile identifier, guest behavior, session invalidation.
5. **Authorization:** page admission, action permission, ownership, item fallback, survey exception.
6. **Files:** database record and filesystem operation remain consistent on success and failure.
7. **Frontend:** Pug label/control, browser module, generated asset, no-JavaScript behavior where applicable.
8. **Tests:** cheapest stable layer plus integration/E2E coverage for cross-boundary behavior.
9. **Documentation:** user, maintainer, operator, and AI instructions remain aligned with the implemented contract.

## In-app help delivery

The in-app help subsystem is intentionally separate from mutable application data:

1. `src/controller/helpController.ts` discovers Markdown only in `docs/user-guide/` and images only in `docs/user-guide/assets/`.
2. A fixed task-group map orders the guides. The same catalog drives the sidebar and server-side search.
3. Markdown is checked against the DEC-004 authoring contract, converted with Marked, given stable heading IDs, and returned with a level-two/level-three table of contents.
4. Internal guide links become `/help/<guide>` routes, and maintained images become `/help/assets/<file>` routes. Path-containment and filename checks prevent request-controlled traversal.
5. Application requests receive a contextual `helpUrl`; the navbar therefore opens the guide for the current feature while retaining `/help` as the fallback.
6. The release workflow attempts to copy and compare the entire user-guide tree, including images, in a separate advisory step. A mismatch or missing documentation is reported without blocking release.

The renderer inserts validated, release-shipped HTML into the Pug view. This is a trusted-content boundary rather than a generic sanitization service. Changing the source model requires reopening DEC-004.

### Documentation reporting is outside application delivery

The required CI workflow runs application checks only. `scripts/report-documentation.mjs` is an optional maintainer
entry point: structural and help-authoring diagnostics, actual-guide content tests, and tooling regressions are
advisory, with real findings and subprocess exits preserved in reports. The corpus-dependent suites are isolated in
`tests/documentation/`; the required help tests use synthetic renderer fixtures and application-only route assertions.
The release copies and compares documentation in a separate non-blocking step. A missing guide, stale fingerprint,
wording mismatch, or unavailable documentation checker cannot stop CI, builds, merges, or release. Runtime content
rejection remains active; see [Documentation Policy](DOCUMENTATION_POLICY.md).
