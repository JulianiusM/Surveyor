# Versioned API and shared contract design

<!--
documentation-metadata
audience: maintainers; frontend and backend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-04
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: step-two design from application commit 0a3662ae0a6e99e0df0a38f603831d3ac9ff4b61, source-reviewed controller/DBAL/HTTP/type boundaries and existing assertion evidence; official OpenAPI, Ajv, openapi-typescript, openapi-fetch, Redocly and HTTP documentation reviewed; no API, generator, dependency, migration, runtime validator, or test implemented or executed
source-anchors: docs/FRONTEND_MIGRATION_BASELINE.md; docs/ARCHITECTURE.md; docs/DEVELOPMENT.md; src/app.ts; src/routes/api.ts; src/routes/api/packing.ts; src/controller/packingController.ts; src/controller/entityAdminController.ts; src/controller/eventPoolController.ts; src/middleware/assignFlowFactory.ts; src/middleware/genericErrorHandler.ts; src/modules/database/services/PackingService.ts; src/modules/database/services/EventInvoiceService.ts; src/modules/invoice/; src/modules/lib/fileCommons.ts; src/public/js/core/http.ts; src/types/; package.json; tsconfig.server.json; esbuild.client.js; tests/integration/packing-workflows.spec.ts; tests/integration/entity-properties.spec.ts; tests/integration/invoice-workflows.spec.ts
next-review: first-packing-contract-foundation-implementation
-->

Adopt authored OpenAPI 3.1 YAML as the single source of wire shapes, generate declaration files and runtime
validators from it, and expose `/api/v1` alongside the current routes. Keep business decisions in the existing
controllers and their feature modules, with transactions and persistence in the existing DBAL. The first
implementation slice proves packing reads, metadata edits, and self-assignment before extending the pattern.

This is a design, not an implemented or validated API. Proposed paths, headers, status mappings, revisions, and
build commands below do not exist yet. The [baseline](../FRONTEND_MIGRATION_BASELINE.md),
[route inventory](ROUTE_INVENTORY.md), and [edge-case records](EDGE_CASES.md) remain the feature-parity evidence.
No executable OpenAPI document is introduced in this step: the examples specify the first implementation slice
without creating a second, incomplete contract that could be mistaken for production truth.

## Contract authority and toolchain

Choose `openapi: 3.1.1`, explicitly set `jsonSchemaDialect: https://json-schema.org/draft/2020-12/schema`,
and use the deliberately small schema subset below. OpenAPI 3.1 supports JSON Schema 2020-12 and permits
multi-file descriptions; its specification version is separate from the application's API version.
This is an interoperability choice, not a claim that 3.1.1 is the newest OpenAPI release.
([OpenAPI specification](https://spec.openapis.org/oas/v3.1.1.html))

| Owner/artifact | Proposed location | Responsibility |
|---|---|---|
| Authored contract entry point | `contracts/api/v1/openapi.yaml` | Version, paths, security scheme, operation IDs, shared responses; references feature files |
| Authored feature contracts | `contracts/api/v1/packing.yaml`, then identity/activity/invoice peers | Request/response schemas, parameters, declared content types and statuses, command policy |
| Authored common schemas | `contracts/api/v1/common.yaml` | IDs, dates, problem variants, pagination and other truly shared shapes |
| Generated bundled description | `.generated/api/v1/openapi.json` | One resolved local contract consumed by both generators; published with matching release |
| Generated type-only owner | `src/types/api/v1.d.ts` | `paths`, `operations`, and `components` declarations from openapi-typescript |
| Generated validator signatures | `src/types/api/validation-v1.d.ts` | Operation/schema mapping referencing the generated contract types; no repeated property declarations |
| Generated executable artifacts | `.generated/api/v1/` | Ajv standalone validator code and operation metadata; browser/server module outputs from the same compiler configuration |
| Authored runtime adapters | Existing/new owning `.ts` modules under server middleware and frontend API infrastructure | HTTP binding, session context, error translation, content-type handling, and invoking generated validators |

Generated files are ignored, regenerated, and shipped as build artifacts; never hand-edit or commit them.
All authored executable source remains `.ts`; generated JavaScript is build output. Import generated declarations
directly from their owner, for example `import type {components} from '../../types/api/v1'`.
Use `components['schemas']['PackingListView']` in controller projection signatures and frontend code. Do not add
barrel re-exports, ORM imports, runtime enums, or a second handwritten `PackingListDto` interface. This follows the
repository's [declaration-file and ownership rules](../ARCHITECTURE.md#feature-modularization-and-source-ownership).

The generation pipeline is:

1. Redocly CLI checks the description and bundles local `$ref` files. Require unique operation IDs/parameters,
   documented statuses/media types, and resolvable references. Do not fetch remote schemas during the build.
   ([Redocly lint](https://redocly.com/docs/cli/commands/lint),
   [bundle](https://redocly.com/docs/cli/commands/bundle))
2. openapi-typescript emits `v1.d.ts` without enum-emission options. It supports OpenAPI 3.1 and emits
   runtime-free types; it does not supply runtime input validation.
   ([openapi-typescript](https://openapi-ts.dev/introduction))
3. A bounded generation script extracts the document's named schemas and operation references, preserving
   reference resolution, and compiles them with `Ajv` from `ajv/dist/2020` plus `ajv-formats`. The script emits
   validator signatures/operation metadata from the same names. It may rewrite references mechanically for
   compilation, but may not author constraints, infer business permissions, or silently discard unknown keywords.
4. Ajv standalone functions validate both server inputs/outputs and browser inputs/responses. Emit server and
   browser module formats from this same configuration, bundle needed runtime helpers, and load only a feature's
   validators in its frontend chunk. Do not compile schemas in the browser or depend on `unsafe-eval`.
   Standalone output can still reference Ajv runtime helpers; bundling must account for them.
   ([Ajv standalone generation](https://ajv.js.org/standalone.html))
5. openapi-fetch consumes generated `paths` for typed calls. A shared frontend adapter adds runtime validation,
   session/locale headers, status preservation, cancellation and error classification. openapi-fetch supplies typed
   request/response inference and exposes the original `Response`; those types alone cannot confirm received JSON.
   ([openapi-fetch](https://openapi-ts.dev/openapi-fetch/))

Pin and verify the selected package versions during implementation. No new package is installed by this design.
Express OpenAPI Validator was considered: it supports Express 5 and OpenAPI 3.1, with JSON response validation.
Selecting it in addition to browser Ajv compilation would introduce two runtime validation configurations to keep
aligned. The chosen shared Ajv path trades that duplication for a small owned HTTP adapter; it must stay a finite
adapter, not grow into another routing framework.
([Express OpenAPI Validator](https://cdimascio.github.io/express-openapi-validator-documentation/))

### The supported schema and transport subset

Use explicit scalar types, object `properties`/`required`, arrays, local `$ref`, enums/const, numeric/string bounds,
patterns, and simple tagged `oneOf` unions. Declare JSON null through a type union, not OpenAPI 3.0 `nullable`.
Close mutation bodies with `additionalProperties: false`; reject unknown input rather than silently dropping it.
Use distinct create/update/read schemas where semantics differ, referencing common subshapes. Avoid recursive
polymorphism, arbitrary maps, deeply composed `allOf`, remote references, custom validation keywords, and schemas
that rely on readOnly/writeOnly to remove privileged fields. The projection controls disclosure.

Configure one strict Ajv 2020 instance with format validation, `coerceTypes: false`, `useDefaults: false`, and
`removeAdditional: false`; use bounded validation errors rather than echoing entire payloads. Register supported
annotation vocabulary explicitly or strip only a documented allowlist of annotations during extraction. Never
disable strict-schema checks just to accept an unsupported construct. `ajv-formats` supplies agreed formats such
as UUID, date and date-time; timezone existence and cross-field date policy remain named semantic checks.
([Ajv schema versions](https://ajv.js.org/json-schema.html),
[options](https://ajv.js.org/options.html), [formats](https://ajv.js.org/guide/formats.html))

The HTTP binding supports path scalars, ordinary single query values, explicitly declared repeated query arrays,
JSON bodies, selected multipart operations, and declared binary/text outputs. Unsupported serialization styles
fail generation. Query/header decoding is a deterministic transport step derived from the declared parameter;
JSON bodies are not coerced. Distinguish absent, empty, repeated and malformed values before validation. Do not
make every feature author write another parameter schema or route-specific serialization framework.

TypeScript cannot express every runtime constraint: maximum length, exact decimals, `oneOf` exclusivity, and
numeric bounds need validators. Conversely, generated type inference can lose meaning in complex composition.
The initial fixture must prove type/runtime parity for this subset, including null, false, optional properties,
unknown properties, tagged errors, multipart metadata, and cross-file references.
([openapi-typescript schema guidance](https://openapi-ts.dev/advanced))

## Server boundaries and DTO projection

The request flow remains explicit:

```text
Express route and existing middleware
  -> identity/context and transport validation
  -> existing controller / named feature operation
  -> DBAL-managed transaction and locked rows
  -> controller-owned checks using those rows
  -> DBAL writes and authoritative read projection
  -> generated response validation and HTTP adapter
```

A generated schema checks shape, not authority, ownership, capacity, deadlines, or financial correctness.
Controllers retain those decisions. The DBAL returns nullable rows and transaction results, and never throws
`APIError`, problem details, translated messages, or browser-specific errors. When a decision depends on a lock,
the named controller operation runs inside the service-managed transaction. Preserve current lock ordering and
after-commit side effects. Reuse existing controller/feature owners instead of parallel SPA business services.
([Current boundaries](../ARCHITECTURE.md#feature-modularization-and-source-ownership))

Do not pass TypeORM entities, Pug render data, `PermBundle`, Express sessions, filesystem paths, or serialized
permission engines over the wire. Current declarations such as [UserTypes](../../src/types/UserTypes.d.ts) and
[InvoicePoolTypes](../../src/types/InvoicePoolTypes.d.ts) contain persistence references and remain internal until
their relevant boundary is deliberately migrated. A controller projection constructs a typed, allowlisted DTO;
response validation detects leaks/shape mistakes but must not be the mechanism that removes secrets.

Expose capabilities needed by the current screen, with specific verbs/fields rather than a universal `isAdmin`.
For packing these include editable root fields, item edit/remove actions, current actor assignment actions,
permission management, event reassociation, and lifecycle actions. Compute them with the current permission and
feature owners. A capability snapshot is display guidance; every mutation reauthorizes. Preserve exceptional
survey, guest, owner and archived-resource behavior rather than imposing packing's policy on every feature.

Privacy belongs to each projection. Packing currently shows assignee names to authorized readers; do not remove
them merely because only managers can remove assignments. Include removal identifiers/actions only where needed
and permitted. Do not add profile emails, full accounts, hidden event titles, permission recipient lists, invoice
proof paths, or private invoice evidence to convenient shared DTOs. Parent identity and disclosed parent labels
are distinct fields. Financial details retain participant/manager scope and applied-versus-pending evidence.
([Packing view](../../src/views/packing/packing-view.pug),
[property presentation](../../src/controller/entityAdminController.ts), [invoice cases](INVOICE_EDGE_CASES.md))

## Identity, sessions, and request context

Keep same-origin cookie sessions. OpenAPI describes the actual cookie security scheme; it does not imply bearer
tokens or replace the permission engine. The bootstrap `GET /api/v1/session` returns a discriminated anonymous,
account, or guest state; active profile and available profile choices remain distinct from account identity and
event registration. Return only the identity/settings needed by the UI, resolved locale information, permitted
entry URLs, and session-scoped CSRF material. Never return session IDs, OIDC tokens, guest access tokens, or an
entire stored session object.

Introduce an opaque login/profile-generation value named `context`. Every v1 request other than bootstrap sends
`X-Surveyor-Context`; successful/error responses identify the admitted context where safe. A stale context returns
409 `SESSION_CONTEXT_CHANGED` before returning a private resource body or admitting a command. A missing required
context is a malformed request; an expired identity returns 401. Login, logout, guest/account transitions, and
profile switches rotate context. Compare against the authoritative session context, not a caller-supplied profile ID.

The frontend also checks its own identity epoch and the response context before accepting data. Include context,
entity type, ID and relevant query/locale in cache keys; clear old identity queries/drafts on an intentional switch.
This prevents a request made with a newly changed shared cookie from filling an old tab's cache. A command admitted
before a switch can finish under its captured original actor; aborting its request does not roll back the database.
Do not automatically replay it under the new identity. Implement session-transition/admission ordering explicitly
and test it; the current application has no such general context protocol.

For v1, expired-session handling must branch before the current global HTML/OIDC redirect in
[app.ts](../../src/app.ts). Return JSON 401 and a safe reauthentication action. Actual OIDC provider login/logout,
activation/reset links, guest-token login, and other external/native identity flows remain browser navigations.
Validate return destinations with the existing owner; do not expose an arbitrary redirect input. Bootstrap can
establish anonymous state for public entry without turning private resource failures into anonymous success.

Cookie-authenticated mutations also need an explicit CSRF boundary: validate a session-bound token and same-origin
request metadata for the new API, including multipart. Do not treat a custom header, CORS settings, or SameSite alone
as the entire policy. This is foundation work, not an assertion that the existing code supplies it. Native adapters
must retain their existing flows while equivalent protection is introduced coherently.
([OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html))

Use `X-Surveyor-Locale` for the SPA's explicit locale, with the shared locale resolver's preference/fallback order.
Responses carrying localized messages declare `Content-Language`. Private reads use at least `Cache-Control:
private, no-cache`; identity and sensitive proof/financial responses retain or use `no-store`. Scope conditional
responses to the current authorized projection and locale, with appropriate `Vary` headers. Authorization and
context checks run before returning 304. A cache tag is never an authorization token.

## Wire values and partial updates

| Value | Contract rule |
|---|---|
| Entity/item/profile UUIDs | Strings with UUID format where the real identifier is a UUID; never an entity object |
| Legacy numeric record IDs | Canonical positive decimal strings in v1, converted only at the owning server boundary with range checks; old routes retain their current number shapes |
| Revisions | Opaque ETag for ordinary edits; the established nonnegative safe-integer invoice calculation revision for reviewed finance commands; reject unsafe numeric conversion |
| Money | Signed fixed two-decimal strings for v1 financial amounts, with endpoint-specific allowed sign/range; no localized separators, binary floats, or unrequested currency field |
| Factors | Canonical decimal strings allowing the existing 0–1000 range and four decimal places; preserve zero; conversion must retain current exact arithmetic |
| Civil dates | `YYYY-MM-DD` with date validation, independent of browser timezone |
| Instants | RFC3339 date-time strings normalized to UTC for responses |
| Local deadline input | Explicit local date/time plus IANA timezone where the existing form has that meaning; resolve through the existing deadline policy, not `new Date()` guesses |
| Booleans | JSON `true`/`false`; never `on`/`off` except inside legacy native-form adapters |
| Optional/null/empty | Omission preserves the current value; null clears only a nullable field; empty string follows the field's existing normalization; no blanket empty-to-null transform |
| Arrays | Preserve ordering where significant; an explicit empty selection means clear, not omit; deduplication only where the existing command specifies set semantics |

No new multi-currency model is proposed. Current financial arithmetic and two-decimal display remain authoritative.
DTO conversion must not round again, reinterpret signed refunds, move historical payments, or erase the saved
numeric evidence described by [EC-INV-014–019](INVOICE_EDGE_CASES.md).

Metadata PATCH accepts a narrow object of editable values. It is an explicitly defined partial-object operation,
not a full replacement and not generic JSON Merge Patch. Reject unknown/read-only fields and `{}`. A title-only
request cannot overwrite description, event association, image, permissions, or hidden dates. Normalize legitimate
legacy values in the owning shared `.ts` normalization operation before shape validation where required, such as
title trimming; the schema remains the only authored structural definition. Converted operations must remove
parallel Joi/express-validator shape definitions, while preserving named semantic checks and legacy form adapters.

## Responses, errors, and localization

Successful JSON responses are explicit resource/result DTOs with declared HTTP statuses, not the legacy generic
`{status, message, data}` envelope. A read returns 200; a creation normally 201 with `Location`; a command returning
current state uses 200; a command with no payload may use 204. Each operation documents its choice. Handle 204/304
before attempting JSON parsing. A success requires the declared status, content type and valid response shape;
HTTP 200 HTML is a transport failure, never proof of a saved mutation.

Use RFC 9457 `application/problem+json` for v1 failures. Include `type`, `title`, HTTP-matching `status`, a safe
localized `detail`, a correlation/request ID, and a discriminated extension containing `code`, `messageKey`, and
typed `params`. Validation problems add field pointers and typed violation codes; do not return arbitrary Joi/Ajv
internals, SQL text, stack traces, bodies, cookies, or file paths. Problem details support extension members; these
specific members are Surveyor's contract design.
([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html))

| Status | v1 meaning |
|---|---|
| 400 | Malformed JSON/parameters, schema validation, unsupported fields, or invalid domain input with no competing state |
| 401 | Authentication/session no longer valid for the operation; API response remains JSON |
| 403 | Current identity lacks the required action or field authority |
| 404 | Missing resource or child outside the route's parent scope; preserve feature-specific disclosure policy |
| 409 | State conflict such as capacity full, relationship context changed, stale reviewed calculation, or session-context mismatch; distinct stable codes |
| 412 | Supplied metadata `If-Match` does not match the currently authorized edit representation |
| 413 / 415 | Oversized payload/file or unsupported request media type/file type, with command-specific details |
| 428 | Required metadata edit precondition was omitted |
| 429 / 503 | Rate limit or temporarily unavailable work; preserve bounded `Retry-After` semantics |
| 500 | Unexpected server error with safe fallback message and correlation ID |

Keep malformed transport, lost response, known rejection, and unknown mutation outcome distinct in the client.
An existing legacy route's status/body remains unchanged during coexistence; v1 adapters map feature outcomes
explicitly rather than altering the global error handler for every caller. Existing error classes may remain
internal while the owning operation acquires stable error codes; translated text must never be parsed into a code.

OpenAPI owns each API error's literal `code`/`messageKey` pair and parameter shape, using a tagged `oneOf` union.
The common catalog at proposed `src/locales/en.json` and sibling language files owns message text. For example:

```json
{
  "type": "urn:surveyor:problem:packing-item-full",
  "title": "Assignment unavailable",
  "status": 409,
  "detail": "This packing item is already fully assigned.",
  "code": "PACKING_ITEM_FULL",
  "messageKey": "api:errors.PACKING_ITEM_FULL",
  "params": {"itemId": "11111111-1111-4111-8111-111111111111"},
  "requestId": "request-correlation-value"
}
```

The catalog does not duplicate API parameter schemas. Generation checks that referenced keys exist and their
placeholders match the contract. Browser and server share the same catalog/translation owner; server `detail`
uses the request locale. A client translates locally only a known, validated key/params combination. For a newer
unknown problem code, a generated common problem validator may retain the safe server `detail` as text; it does not cast
unknown params into a known error variant. This compatibility fallback cannot report an unknown success DTO as saved.

## Optimistic concurrency and conditional reads

Use separate tokens for separate meanings. `updatedAt` is not an aggregate revision, a transaction lock is not an
old-form detector, and a full-page cache ETag is not a financial confirmation token.

| Boundary | Existing protection | Proposed v1 contract and implementation work |
|---|---|---|
| Packing metadata | Root lock plus expected event context obtained during request handling; no general same-field stale-form detection | Dedicated metadata resource, monotonic metadata revision, strong ETag, required `If-Match` |
| Event relationship | Explicit `expectedEventId`, locked roots/parents and reauthorization; an already achieved target can be a harmless retry | Require the expected relationship and a token backed by a monotonic relationship revision for an actual move; preserve the already-achieved target no-op after current authorization |
| Assignment capacity | Item lock, existing-assignment check before capacity, transactional insertion | Retain natural idempotency and locked checks; do not require the list metadata ETag |
| Item metadata/order/permission matrices | Feature-specific checks with uneven general stale-write protection | Define the appropriate item/collection edit token per slice; do not label every write protected by the packing root revision |
| Invoice preview/apply | `calculationRevision` and root lock, including payment-triggered revision changes | Keep reviewed `expectedRevision`, stale conflict 409 and current command-specific confirmation rules; separate from cache ETags |
| Activity recommendation apply | Existing contexts/fingerprints and coordinated locks | Preserve reviewed-result checks; a new transport token cannot replace their cross-plan scope |

Create `GET/PATCH /api/v1/packing-lists/{listId}/metadata` as the edit representation. It contains only the current
actor's editable metadata values and relevant capability/parent context. Its strong ETag covers canonical serialized
representation bytes, a monotonic metadata revision, and the actor/context-dependent projection. Revision inclusion
detects edits that change a value away and back. Recompute current permissions/context before comparison; revoked
authority returns 403 instead of disclosing hidden current values in a conflict response.

The metadata edit representation contains machine values, field identifiers, and capability/context facts, without
translated labels or messages. Localize its controls separately through the shared catalog. Changing locale alone
must not invalidate the reviewed metadata ETag; include locale in a read-cache key or view ETag only when that
representation actually varies by locale.

PATCH requires the exact strong `If-Match` obtained for that metadata representation. Reject missing precondition
with 428 and a stale one with 412. Do not accept weak tags or `*` as permission to bypass this edit protocol. After
success return the fresh authorized metadata representation and ETag. A full list GET has its own ETag covering
items, assignments and capabilities; it cannot be used as the metadata edit tag. Keeping these distinct avoids
conflicts when another participant simply assigns an item.
([HTTP strong comparison and If-Match](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match),
[428 Precondition Required](https://www.rfc-editor.org/rfc/rfc6585.html#section-3))

The metadata revision is a new persisted field requiring entity changes and a reviewed migration. Every writer of
covered fields, including legacy description/property commands and relevant native/controller paths, must advance
it under the same root transaction. Parent reassociation must invalidate the edit context; grant/lifecycle changes
must change the current capability/context projection or its owning revision. Assignment-only writes must not
advance metadata revision. Build an explicit writer inventory and tests before enabling `If-Match`; otherwise old
routes could silently bypass the protection. No revision column or protection has been added by this design.

The separate relationship command carries `eventId`, `expectedEventId`, and `expectedRelationshipToken`.
Reauthorize against the locked current source and target. An already-achieved desired association remains a no-op;
an actual move requires both the expected parent and current monotonic relationship token, otherwise 409. Increment
the relationship revision through every legacy/v1 association writer, including moves away and back, and invalidate
the affected metadata context. This is additional migration work, not an existing `expectedEventId` guarantee.

For a 412, preserve the draft and load a fresh authorized baseline. Compare original, local draft and current
server values; offer review/reapply or discard. Never silently merge a conflicting field or refresh a draft's
original comparison token. A reapply sends the newly reviewed token. Financial calculation conflicts always need
a fresh preview and explicit review of its effects, not ordinary field merging.

Reads may use `If-None-Match` to avoid retransmitting unchanged authorized data. Their ETag covers the exact DTO
projection including capabilities and any localized content, not just the root timestamp. For packing, obtain
items/assignments/counts/capabilities from a consistent read snapshot or explicitly proven equivalent revision
scheme; the current `fetchForView` performs several reads and does not itself establish one aggregate snapshot.

## Idempotency and retry policy

Declare per-operation policy in the authored contract, for example an `x-surveyor-command` extension with
`retryPolicy: read | natural-idempotent | reconcile-only` and its precondition kind. Generate the client policy
registry from those declarations; do not infer retry safety from POST/PUT names or from a disabled button.

| Operation family | Policy |
|---|---|
| Authorized GET reads | Bounded retry where appropriate; abort obsolete reads and honor backoff; never retry a scope/auth failure as another identity |
| Packing/drivers self-assignment to the same actor/item | Naturally idempotent while current authorization permits it; repeated assignment returns the existing result before capacity rejection |
| Idempotent removal/explicit desired-state commands | Preserve the specific existing no-op rule; reauthorize every retry and reconcile current desired state |
| Metadata PATCH with If-Match | Reconcile after an uncertain result; a lost successful response makes the old token stale, not proof of failure |
| Invoice upload, organizer expense, token consumption, arbitrary creation | Reconcile-only by default; no automatic repeat after response loss |
| Reviewed financial/recommendation commands | Retain revision/fingerprint rejection; inspect current state and obtain a new preview before a new command |

No generic server idempotency-key store is introduced in the first packing slice. If later needed for an expense
or another creation endpoint, design its key scope, request fingerprint (including file identity), transactionally
stored result, retention, concurrent in-progress behavior, and same-key/different-body rejection as a feature.
Such a contract needs persistence and integration evidence; it cannot be promised by a frontend retry plugin.
The existing [organizer response-loss E2E](../../tests/e2e/invoice-organizer-expenses.spec.ts) proves locked recovery
and one saved expense after a lost response, not a general idempotency-key facility.

## Multipart, files, and non-JSON routes

Keep upload transport explicit in OpenAPI. Preserve the named file fields (`image`, participant `proof`, optional
organizer `proof`), supported extension/MIME sets, and existing 10 MiB limit. For mixed data use a declared JSON
metadata part plus binary file part in v1, decoded once into the generated command schema and a server-owned file
descriptor. Legacy forms keep their current field layout through an adapter. Generated client types may map the
declared binary field to `Blob` through one generation transform; do not put `File`/`Buffer` into the authored JSON
shape or handwrite a parallel multipart DTO.

Ajv validates decoded JSON metadata and safe file metadata, not streams or file bytes. Authentication, permission
checks and CSRF rejection run before writing uploads. Multer/storage policy enforces bounded files and server
filenames. Current [file handling](../../src/modules/lib/fileCommons.ts) checks independent extension and declared
MIME allowlists; it does not prove extension/MIME pairing or inspect image/PDF content. Do not claim stronger
validation merely because the contract lists a media type. Preserve cleanup ordering and the known boundaries in
[EC-UI-08](EDGE_CASES.md) and [EC-INV-009–010](INVOICE_EDGE_CASES.md).

The browser owns multipart boundaries; do not set JSON `Content-Type` for FormData. Retain an upload-progress adapter
for participant invoices because ordinary fetch does not supply the current XHR upload-progress behavior. Its
request shape, headers, response validation and outcome classification must use the same contract owner.
([Current upload state machine](../../src/public/js/modules/invoice-submission.ts),
[openapi-fetch body serialization](https://openapi-ts.dev/openapi-fetch/api))

PDFs, proof files, print HTML, OIDC and token links remain separate route types. Declare binary/text media types
where exposed in v1, and preserve existing page routes during migration. Do not JSON-validate file bytes or turn
every output into a SPA view. The event participants PDF is currently served inline; invoice shares have their own
attachment filename and no-store policy. Proof access remains authorized on every request, independent of earlier
capabilities. Preserve native links/downloads/new tabs, draft retention, and saved-calculation export semantics.
([Event outputs](../../src/routes/event.ts), [activity print output](../../src/routes/activity.ts))

## Worked first slice: packing

These are proposed v1 operations, not replacements already mounted in Express. They supplement the current
[packing API](../../src/routes/api/packing.ts) and reuse its controller/DBAL behavior. The frontend still uses
`/packing/{id}` as its bookmarkable page route.

| Method and path | Operation ID | Result and ownership |
|---|---|---|
| `GET /api/v1/packing-lists/{listId}` | `getPackingList` | 200 `PackingListView`, full-view ETag; same read authority as the existing detail page |
| `GET /api/v1/packing-lists/{listId}/metadata` | `getPackingMetadata` | 200 `PackingMetadata`, metadata ETag; only fields the current actor may edit |
| `PATCH /api/v1/packing-lists/{listId}/metadata` | `patchPackingMetadata` | 200 fresh `PackingMetadata`; field authority, context and required If-Match checks |
| `PUT /api/v1/packing-lists/{listId}/items/{itemId}/self-assignment` | `putPackingSelfAssignment` | 200 authoritative current item-assignment result, whether newly inserted or already present |
| `DELETE /api/v1/packing-lists/{listId}/items/{itemId}/self-assignment` | `deletePackingSelfAssignment` | 200 authoritative unassigned result; removing an absent self-assignment remains harmless |

`PackingListView` has `entityType: packing`, ID, title, nullable description, allowed header URL, disclosed event
reference, lifecycle presentation, root capabilities, counters, and ordered items. Each item has ID, title,
description, position, `requiredByAll`, nullable maximum, current count, `selfAssigned`, visible assignee names,
and its permitted action flags. Project only authorized assignment-removal identifiers. Keep current counter
semantics: Everyone items do not contribute to participant/open/empty counters. The current UI sorts Everyone
items ahead of normal position. `Packed?` remains browser-local `packed_{listId}_{itemId}` state; it is not a shared
assignment field or a new server preference.
([Packing projection](../../src/controller/packingController.ts),
[browser-local packed state](../../src/public/js/packing.ts))

`PackingMetadata` has `entityType`, ID, partial `values` containing only editable `title`/`description`,
`editableFields`, and permitted parent/capability context. Its ETag is returned as a header, not stored in form
values. In the authored schema, `PackingMetadataPatch` is an object with `minProperties: 1`,
`additionalProperties: false`, optional nonblank trimmed title up to 255 characters, and optional description
up to 16000 characters or null. Empty description keeps the current normalization to null. The concrete structural
schema belongs only in the eventual YAML; these limits match the current
[normalization owner](../../src/controller/entityAdminController.ts).

### Scenario A — Fresh read and periodic refresh

1. Bootstrap session, then GET the packing list with `X-Surveyor-Context` and `X-Surveyor-Locale`.
2. Validate 200 JSON as `PackingListView`; retain response ETag and admitted context. Do not expose entity
   internals or treat the full-view ETag as permission to edit metadata.
3. Conditional refresh reauthorizes and returns either 304 or a fresh DTO. An assignment changes counts and
   assignees without replacing an open metadata draft or local Packed? checkboxes.
4. A profile switch makes an old request obsolete even if it resolves later. A context mismatch returns only
   its problem, not the new profile's packing data under the old cache key.

**Missing current protection:** there is no v1 read projection, scoped request protocol, conditional polling,
or proved consistent packing aggregate read yet. Current `fetchForView` can be reused as behavioral evidence but
must not be serialized wholesale as the contract.

### Scenario B — Two editors change metadata

Editor A and B fetch metadata ETag `"packing-meta-a"`. A sends:

```http
PATCH /api/v1/packing-lists/11111111-1111-4111-8111-111111111111/metadata
Content-Type: application/json
If-Match: "packing-meta-a"
X-Surveyor-Context: current-session-context
X-Surveyor-Locale: en
X-CSRF-Token: current-session-csrf-token

{"title":"Camping equipment"}
```

The controller rechecks submitted-field authority against current locked state, verifies the edit tag, persists
only title, increments metadata revision, and returns the normalized representation with `"packing-meta-b"`.
B's old-tag description change returns 412 without writing; the UI retains B's draft and offers review against the
fresh baseline. Missing If-Match yields 428. Forged `ownerId` is a shape error; a valid but unauthorized description
field gives 403. A concurrent assignment alone does not invalidate the metadata tag. No guessed default overwrites
an omitted description or event link.

**Missing current protection:** [saveProperties](../../src/controller/packingController.ts) locks the root and
checks request-time event context, but accepts a later stale title from another browser. There is no metadata
revision today. Add the revision/writer coverage and reauthorization-at-write boundary before claiming this
scenario; preserve existing relink/root lock coordination rather than introducing an independent transaction.

### Scenario C — Full item and a lost assignment response

PUT self-assignment has no actor/profile ID in its body: use the admitted session profile. Verify that the item
belongs to the route list, then apply the existing capacity operation. First check missing item, then existing
assignment, then capacity. When the same actor retries after its first success, return 200 assigned even if the
item is now full; do not create another row. A different actor reaching a full item receives 409
`PACKING_ITEM_FULL`. A foreign item ID receives the existing scope-safe 404. Every retry requires current authority.

Return a small authoritative item-assignment projection and invalidate/reload dependent counters/list data.
Do not pretend an optimistic button state establishes the final count, and do not use a metadata revision for
this command. Preserve Everyone-row presentation without inventing a new backend prohibition as part of this slice.

**Existing evidence:** [controller assignment ordering](../../src/controller/packingController.ts),
[item lock/insertion](../../src/modules/database/services/PackingService.ts), and
[assignment scope middleware](../../src/middleware/assignFlowFactory.ts) establish current checks;
[packing integration assertions](../../tests/integration/packing-workflows.spec.ts) check duplicate assignment
and sequential capacity rejection. They do not prove a browser lost-response recovery or simultaneous final-place
race. Audit authorization/root-context changes during the operation and concurrent capacity-edit writers before
claiming a broader aggregate concurrency guarantee.

## Coexistence, rollout, and verification

Mount `/api/v1` before the legacy `/api` catch-all and before an HTML-only invalid-session redirect can intercept
it. Keep legacy `/api/packing/...` and native form/page/token/export routes working until their consumers migrate.
Both versions call the same named feature operations; adapters translate legacy field/checkbox/envelope shapes.
Do not redirect a legacy mutation to v1 or make an SSR/native adapter call its own HTTP server. Server rendering
and native fallback actions reuse the controller operations and projections directly while retaining the existing
redirect/flash workflow where promised.

Native forms cannot supply the SPA's custom headers. Where a native action participates in the new guarantees,
render the admitted identity context, session-bound CSRF token, and relevant edit/relationship precondition as
hidden fields, then validate them through the same owning checks before invoking the operation. Hidden fields are
untrusted input, not authority. Extract these transport fields separately from the generated business-body schema;
do not forward them as editable entity properties. Reject a stale identity or edit token without silently overwriting
data; preserve the submitted draft and native error/redirect behavior as appropriate. Regenerate context-bound fields
on a fresh authorized render. An old form missing newly required preconditions needs draft-preserving recovery, not
an unconditional write. Advancing revisions in legacy writers protects v1 stale saves; it does not make those older
forms conditional by itself. Direct controller invocation must not become a bypass for checks otherwise enforced
by API middleware. These adapters and protections are proposed implementation work, not existing native-form guarantees.

Version the contract independently (`info.version` within major `/v1`). Add optional response fields compatibly,
but treat required-field additions, enum changes, meaning changes, privacy changes and status changes as reviewed
compatibility work. Clients must tolerate explicitly allowed unknown response fields for rolling releases while
servers validate the exact known projection they emit. This may use a generated response-validation mode that
permits additive properties, never a duplicate authored response schema; it must not loosen request validation or
discard received fields as a substitute for server projection. Keep old route/page bookmarks and email links
through documented adapters; move to `/v2` only for intentional breaking wire behavior.

The browser's generated tolerance applies to additive properties at nested response objects as well as the root;
known fields, required members, types, bounds, and union discriminants still validate. Prove this with a fixture that
runs an older browser validator against a newer server response containing both root and nested additive fields,
then rejects malformed known fields in the same response. Requests and server-emitted projections remain strict.
Do not enable this compatibility mode without that fixture, or treat a changed enum/discriminant as an additive field.

At implementation, add one `generate:api` owner to the existing generation/build flow. It produces the bundled
contract, types, runtime validators and a deterministic source hash manifest before either server/client type
checking or bundling. Direct client build/development/test entry points that import these outputs must also prepare
them; existing `generate` currently only prepares the DB entity/migration index. Package validators and the matching
contract into production output; keep generator tooling out of runtime startup. No command above is currently a
package script, and no test result is claimed here.

The first implementation's meaningful checks are:

- A database-free clean-generation fixture compiles valid/invalid examples through both runtime targets and
  type-checks server/client consumers. It proves the chosen schema subset, references, error unions, ignored output
  regeneration, module formats, formats, and absence of hand-authored parallel shapes. Compare generated hashes
  after independent generation; `git diff` cannot detect drift in ignored output.
- Transport tests check required headers, JSON versus HTML, content types, unknown fields, null/false/omission,
  204/304, safe problem formatting, and route-to-operation/schema coverage. Response validation must detect a
  deliberately leaked property in a synthetic projection fixture.
- Existing packing/property integration tests continue to protect behavior. Add two-editor stale metadata,
  legacy-writer invalidation, parent/grant change, duplicate assignment, and a real simultaneous final-place race
  only where those new protections are implemented. Database tests still use guarded disposable schemas.
- A narrow browser journey proves initial read, dirty-form refresh, 412 draft retention/review, identity-context
  change, and idempotent assignment recovery. Reuse prior visual/behavior IDs instead of replacing their semantics.
- Once the pilot passes, expand contract/read/write coverage feature by feature, retaining invoice and activity
  concurrency owners and native fallback boundaries. Do not publish unimplemented routes as available features.

These are application contract/build checks, not documentation assertions or a new prose approval gate. The
design remains advisory. It is ready for a bounded packing proof slice; its generator, runtime/type parity,
revision migration, context protocol, and route adapters still require implementation and verification.
