# Versioned API and shared contract design
<!--
documentation-metadata
audience: maintainers; API developers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-12
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: original authored-contract choices retained; approved 2026-10-12 public-method admission, minimal baselines, coexistence locking and canonical Help corrections reconciled with source; execution owned by paired review
source-anchors: contracts/api/v1/; scripts/generate-api.mjs; src/modules/api/; src/controller/packingController.ts; src/routes/api/v1/; src/frontend/app/transport.ts; src/frontend/features/; src/types/; tests/integration/packing-public-actions.spec.ts; tests/integration/packing-coexistence.spec.ts; tests/e2e/frontend-pilot-api.spec.ts; docs/frontend-migration/FRONTEND_FOUNDATION_DESIGN.md
next-review: next-contract-migration-or-authorized-cutover
-->

Authored OpenAPI 3.1 YAML is the single wire-shape authority. Generate declaration contracts and runtime validators;
expose `/api/v1` beside native routes. Business decisions belong to existing controllers and pure DBAL retains
transactions/persistence. A DTO deliberately differs from an entity; one wire shape must never be handwritten again.

The [baseline](FRONTEND_MIGRATION_BASELINE.md) owns behavior/route exceptions.
[Foundation](FRONTEND_FOUNDATION_DESIGN.md#original-decisions-and-dated-amendments) owns original choices and dated
amendments. Invoice/activity examples below remain future v1 scope; current Help/Packing/overview/identity contracts
are authoritative in their YAML rather than a second maintained endpoint matrix.

## Implemented foundation boundary

The generated contract/client/validator/session/locale framework is present.
Packing now uses named shared operations and central method permission definitions in its existing controller.
Native middleware, v1 authorization and capability projections consume that policy. Existing administration/event/
image operations retain their own owners. Adapters decode/present native and generated v1 protocols; conditional
comparison remains v1-specific. Source ownership consolidation and the approved coexistence remedy are implemented;
final execution and its limits are tracked separately in the review.

Help has one canonical release-owned tree: native English at `docs/user-guide/`, with pilot language corpora in its
catalog-selected directories such as `en/` and `de/`. Staged maintainer documents are never runtime sources.
Final build/application/concurrency/browser evidence belongs to the [review](PILOT_PARITY_REVIEW.md).

## Contract authority and toolchain

Use `openapi: 3.1.1` and JSON Schema draft 2020-12. This is the original interoperability choice, not a claim about
the newest specification. [OpenAPI specification](https://spec.openapis.org/oas/v3.1.1.html)

| Owner/artifact | Responsibility |
|---|---|
| `contracts/api/v1/openapi.yaml` | Version, operation IDs, paths/security/status/media policy and local feature references. |
| Feature YAML and `common.yaml` | Operation-specific shapes plus genuinely shared IDs/problems/pagination. |
| `.generated/api/v1/openapi.json` | Locally bundled description consumed by generators and packaged with the release. |
| `src/types/api/v1.d.ts` | Runtime-free paths/operations/components from openapi-typescript. |
| `src/types/api/validation-v1.d.ts` | Validator/operation signatures referring to those generated declarations. |
| `.generated/api/v1/` | Standalone validators and operation metadata, with matching browser/server outputs. |
| Existing HTTP adapter/feature API owner | Decoding, context/media/status/validation binding and controller invocation. |

Generated outputs stay ignored. Import declarations directly; no forwarding module, barrel, ORM import or handwritten
DTO. Versions belong to package/lockfile. Authored application code is TypeScript; generated JavaScript is output.

The finite generation pipeline is:

1. Redocly lints/bundles local references, unique operation IDs/parameters and declared statuses/media.
   Builds never fetch remote schemas. [Redocly](https://redocly.com/docs/cli/commands/bundle)
2. openapi-typescript emits runtime-free declarations without enum emission.
   Types do not validate received JSON. [openapi-typescript](https://openapi-ts.dev/introduction)
3. The bounded script extracts named schemas/operations and compiles strict Ajv 2020 with ajv-formats,
   preserving resolution and declared constraints; it cannot invent business policy or discard unsupported keywords.
4. Standalone functions validate server inputs/outputs and browser inputs/responses. Bundle required runtime helpers;
   feature chunks load their own validators. No browser/startup schema compilation or unsafe-eval.
   [Ajv standalone](https://ajv.js.org/standalone.html)
5. openapi-fetch consumes generated paths; the shared adapter adds runtime validation, headers, cancellation and
   status classification while retaining the original Response. [openapi-fetch](https://openapi-ts.dev/openapi-fetch/)

The original alternative Express OpenAPI Validator would add a second runtime validation configuration alongside
browser Ajv. The selected shared compiler avoids that duplication in exchange for a small owned HTTP adapter.
Do not grow that adapter into another controller/routing framework.

### The supported schema and transport subset

Use explicit scalars, object properties/required, arrays, local refs, enums/const, bounds/patterns and simple tagged
oneOf unions. JSON null uses a type union, not OpenAPI 3.0 nullable.
Mutation bodies are closed; unknown fields are rejected rather than silently dropped.
Separate create/update/read semantics and reusable subshapes; projections control privilege disclosure.

The original preference avoids recursive polymorphism, arbitrary maps, deep allOf, remote references, custom
validation vocabulary and readOnly/writeOnly as disclosure controls. Two bounded native-preserving extensions are
explicit rather than silently changing that preference:

- Registration/reset author `x-surveyor-min-length-utf16: 8`, preserving native eight UTF-16 units.
  Standalone browser/server validators share that constraint; passwords acquire no maximum.
  Ordinary JSON Schema string bounds retain code-point semantics. Native metadata diagnostics retain native policy,
  rather than a claim that frozen native validators were converted to generated schemas.
- Existing-item capacity permits the finite number/string/null primitive union, retaining raw scalar transport
  to the existing signed nullable SQL column. Database rounding/range/failure remains authoritative.
  Creation/new-item rules remain separate; no blanket coercion, browser minimum or copied SQL-limit policy.

Keep Ajv strict with format checking, no type coercion/default insertion/additional-field removal.
Register only supported annotation vocabulary; unsupported constructs fail generation rather than disabling strictness.
Timezone existence/cross-field date rules remain named controller checks.
[Ajv options](https://ajv.js.org/options.html), [formats](https://ajv.js.org/guide/formats.html)

Binding supports declared path/single query/header scalars, JSON, Packing multipart and scoped binary image responses.
Creation decodes the `data` JSON part once against the authored nested schema and handles `image` separately.
Absent/empty/repeated/malformed transport values stay distinct. Arbitrary arrays/text/binary serialization are not
general adapter capabilities; unsupported styles fail generation.

TypeScript cannot express every bound or exclusivity constraint. Compile/runtime fixtures must prove supported
null/false/optional/tagged cases and standalone loading rather than introducing a second validation language.

## Server boundaries and DTO projection

The approved shared-backend target reuses named controller operations for native/v1.
Adapters decode their own request and select response/error presentation; controllers own authorization, capacity,
ownership, validation, orchestration and contextual errors. DBAL owns queries/locks/transactions/persistence.
Checks needing locked current data execute as named controller callbacks inside the existing transaction.

Central method permission definitions belong in the controller and apply native policy to pilot actions.
Keep action admission independent of page membership when native action grants allow it; edit authority/projections
must remain private. Inherited permission mismatch is `IMP-022`, not a reason to silently tighten or broaden policy.
UI capability snapshots guide presentation and never authorize writes.

DTOs expose only actor-permitted data/capabilities. Never serialize entities, sessions, PermBundle, filesystem paths
or hidden original values into generic contract objects. Preserve feature-specific owner/guest/archive/child-scope
and disclosure policy rather than generalizing Packing rules to surveys or finance.

## Identity, sessions, and request context

Use same-origin cookie sessions. Session bootstrap distinguishes anonymous/account/guest, active profile and event
registration; return only UI-needed identity/entry/locale/CSRF data, never session IDs/provider/guest tokens.

Subsequent scoped v1 requests send `X-Surveyor-Context`. The server compares authoritative session generation before
private reads/commands; stale context yields `SESSION_CONTEXT_CHANGED`, while missing/expired context follows its
declared error. Login/logout/profile/guest transitions rotate context. A caller's profile ID is not authority.

The browser checks captured context/identity epoch before adopting results. Intentional switches resolve drafts,
retire private queries and bootstrap the new identity. A command already admitted for the original actor may finish;
aborting HTTP is not transaction rollback and cannot justify replay as another actor.

The API mount precedes HTML/OIDC redirect handling. Structured API expiry stays JSON; known invalid credentials/token
are confirmed rejections rather than global identity invalidation.
Identity operations admit old context/CSRF and bind successful results to the new context.
Stored-context rechecks protect slow transitions; this is not a session-store compare-and-swap guarantee.

Cookie mutations validate session CSRF and same-origin metadata, including multipart.
Custom headers, SameSite and CORS alone are not complete policy.
Native adapters retain established transport/status/flash semantics; no new native hidden conflict fields are claimed.

`X-Surveyor-Locale` chooses supported response language; localized results declare Content-Language.
Private/identity/sensitive responses follow endpoint caching policy. Reauthorize conditional reads before 304;
ETag/Vary is never authority. Context/local locale scope cannot leak into a singleton cache.

## Wire values and partial updates

| Value | Preserved wire meaning |
|---|---|
| UUID identifiers | UUID strings where the real identifier is UUID, never entity objects. |
| Numeric assignment handle | Canonical positive decimal string; undisclosed handles null. Safe internal conversion only at owning persistence boundary. |
| Ordinary edit token | Opaque current-value comparison, distinct from reviewed financial revision/history. |
| Financial amounts/factors | Future canonical decimal strings, preserving existing sign/range/precision/arithmetic; no locale separators or invented currency model. |
| Civil date / instant | YYYY-MM-DD independent of browser timezone / normalized RFC3339 UTC. |
| Local deadline | Explicit local date/time plus owning IANA timezone policy, not new Date guesses. |
| Boolean | JSON true/false; legacy checkbox decoding belongs to native adapter. |
| Omitted/null/empty | Omission preserves, null clears nullable values, empty follows field normalization; no global empty-to-null conversion. |
| Array | Ordering/set semantics are operation-specific; explicit empty may clear rather than omit. |

PATCH is an authored sparse editable object, not full replacement or generic JSON Merge Patch.
Reject unknown/read-only fields and empty writes. A title update cannot alter unrelated description/image/event/
permission/date state. Shared operation normalization preserves native semantics without changing frozen form
validation or duplicating business decisions.

## Responses, errors, and localization

Successful JSON DTOs use declared HTTP/media/status policy; legacy envelopes remain native adapter behavior.
Handle 204/304 before JSON parsing. HTML 200 or an invalid response cannot confirm a command.

V1 failures use RFC 9457 application/problem+json with matching status, safe localized detail/request ID and correlated
code/messageKey/typed params; validation adds bounded field pointers/violation codes.
Never return raw validators, SQL/stack/payload/cookie/path details.
[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html)

Keep known code/status/message/parameter variants correlated. Unknown future errors can show validated safe detail
but cannot trigger known machine actions. Translated text is never machine state.
401 credentials differs from expiry, 403 field/action denial from parent read loss, and 404 foreign child from global
resource disappearance. Follow each operation's authored disclosure policy.

## Current-value comparisons and conditional reads

Approved D2 supersedes the monotonic Packing metadata revision and broad cross-panel comparison.
Scoped tokens hash current relevant values plus actor/resource context; no counter/history/lease/presence infrastructure.
Native request bodies/last-write behavior remain unchanged. A native write changes current values compared by v1;
native original-value submission or overlap feedback is not implemented or promised.

| Operation | Comparison boundary |
|---|---|
| Metadata | Sparse submitted fields under parent/root context locks; preserve unrelated changes. |
| Item/Everyone | Item current-value token and locked field/capacity policy. |
| Item order | Exact reviewed membership/order token. |
| Event link/default masks/admin setup | Relevant current setup fields and independently granted owning policy. |
| Capacity-sensitive assignments | Existing locked count/membership/idempotent behavior; not metadata revision. |
| Finance/recommendations | Existing calculation revision/fingerprint/review guarantees; future adapter preserves them. |

Missing required If-Match is 428; mismatched touched comparison is 412 without a write.
Weak/wildcard tags do not bypass application comparison. This is an authored field protocol carried in If-Match,
not a promise of monotonic history: change-away/change-back can match prior values.

Dirty refresh preserves original/local/current. Unrelated remote changes can advance untouched fields; overlaps
require explicit review/reapply. A 412 response cannot disclose hidden values.
Reconciliation never automatically writes. Conditional GET rechecks current actor/scope before unchanged responses.

An independently permitted conditional write must have a usable independently permitted baseline read. Packing's
item-edit baseline returns only method-permitted fields and hashes; its order baseline returns only item IDs/positions
and the existing order token. Defaults, one administrator, header and description have equally bounded baselines;
none borrows detail/settings admission or a previously issued private token. Reauthorize before `304`, and filter
comparison hashes as well as visible values. These reads do not disclose unrelated fields, rosters or parent context.
The YAML owns `getPackingDescription`/`updatePackingDescription`, `getPackingDefaultsBaseline`,
`getPackingAdminBaseline` and `getPackingHeaderBaseline`; do not reconstruct their shapes from full settings.

### Approved public-method and coexistence amendment (2026-10-12)

The initial pilot's blanket profile requirement narrowed independently granted native methods. The explicit
[maintainer amendment](FRONTEND_FOUNDATION_DESIGN.md#explicit-canonical-location-and-action-decisions-2026-10-12)
now admits those methods using the captured session context without inventing a shared anonymous actor. Item
edit/order/delete, administrator assignment removal, default/admin management, scoped profile discovery, header
write/preflight and the legacy description-only action follow current native method grants. The authored description,
defaults, administrator and header baseline operations expose only their permitted comparison state. Profile-required
reads and commands retain their original boundary; the [admission matrix](staged/DEVELOPMENT.md#backend-and-method-policy-contracts)
distinguishes them. Context checks, mutation CSRF and fresh authorization remain mandatory; conditional operations
retain actor-bound comparison tokens.

Native and v1 profile discovery share the existing per-IP 120-search/10-minute budget. Native rate-limit text remains
unchanged; v1 maps rejection through its existing localized Problem owner. No global permission redesign is implied.

The approved native assignment remedy takes the list's shared lock before the item's exclusive lock. It preserves
parallel native assignments on different items while v1 retains its exclusive root-before-item/order coordination.
Native removal/overwrite outcomes and missing-item handling remain unchanged. This bounded correction removes the
reproduced FK/root-item cycle; it does not promise that unrelated future writers are free of deadlocks.

## Commands, multipart and recovery

D4 is reconcile-only without operation tracking. Commands retry zero times by default.
A lost response is unknown until endpoint-specific evidence establishes more; reads cannot prove an unknown creation
failed. Preserve input, explicit review and acknowledged departure. Confirmed save plus failed read remains saved.

Creation/duplication, uploads, delete and finance have distinct unknown-outcome semantics.
Do not replay uploads, rebase reviewed money, invent idempotency guarantees or infer rollback from cancellation.
Reapply is an explicit new user action against reviewed current state.

File commands retain existing size/type/storage/ownership/retention checks and post-commit side effects.
Multipart validation owns its decoded JSON and file parts separately; MIME allowlists alone do not prove content or
extension/MIME pairing. Image/print/download/provider boundaries stay explicit document/binary operations.
Never expose filesystem paths or introduce server self-HTTP.

## Coexistence, rollout, and verification

Native/v1 adapters translate distinct input/status/feedback around shared controller operations and pure DBAL.
Neither route is redirected into the other's HTTP endpoint. Stronger v1 preconditions do not add fields/conflict
behavior to frozen native forms. Adapters retire independently only after consumers migrate and cutover is approved.

D3 corrects unreleased v1 in place. After a version is released, compatible additive response fields and optional
operations can remain in that version; browser validators accept compatible additions. Removing/renaming fields,
changing their type/meaning, adding mandatory request data, or changing an existing operation's authorization or
outcome contract is a breaking change and needs an explicitly approved version/migration decision. Keep the released
contract available for its supported consumers until their retirement is authorized; never silently replace a released
schema or tighten it to match a new frontend. This compatibility policy does not authorize another unreleased pilot
version. D5 current-folder replacement uses the shared session/release protocol; incompatible commands retain drafts.

Generate before checks, preserve declaration-only contracts and feature-local validators, and verify actual native/
v1 authorization/private projections. Real TypeORM coexistence cases protect touched-field and capacity scheduling;
mounted consumers protect unknown/confirmed recovery; source/SSR/build boundaries receive their focused checks.
Latest execution and remaining limits belong to the [review](PILOT_PARITY_REVIEW.md). Documentation reports remain advisory.
