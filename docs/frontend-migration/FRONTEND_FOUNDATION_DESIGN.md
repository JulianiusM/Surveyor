# Frontend foundation design
<!--
documentation-metadata
audience: maintainers; frontend developers; API developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-12
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: original design and dated approved shared-backend/Help/permission corrections consolidated; completed scoped execution and its limits owned by paired review
source-anchors: docs/frontend-migration/FRONTEND_MIGRATION_BASELINE.md; docs/frontend-migration/FRONTEND_PILOT.md; docs/frontend-migration/; contracts/api/v1/; src/controller/; src/modules/database/services/; src/frontend/; src/modules/frontendPilotRenderer.ts; src/modules/frontendDevelopment.ts; src/types/; package.json; vite.config.mts; .github/workflows/ci.yml
next-review: next-migration-slice-or-authorized-cutover
-->

Surveyor's target frontend is Vue 3 and TypeScript with Vite, Vue Router and TanStack Vue Query. Authored OpenAPI
generates shared declaration types and runtime validators; shared language catalogs serve browser and server.
Express retains HTTP/session ownership. Existing controllers own business decisions and pure DBAL services own
queries, transactions, locks and persistence.

The [baseline](FRONTEND_MIGRATION_BASELINE.md) and its 121 edge-case IDs describe the native contract.
The original step-two design was based on `0a3662ae0a6e99e0df0a38f603831d3ac9ff4b61`; the native comparison reference
is `2dfa2573c64178f54684cc4877b5a945f66e24c8`. The reference does not identify a deployed site's version.
Help/Packing and necessary entry/foundation behavior are the current completeness obligation; other feature
migration and default-route cutover remain future work.

## Original decisions and dated amendments

Keep original choices visible when recording an amendment. An alternative described by a design document,
passing tests or an implementation spike cannot authorize a technology substitution.

| Original choice | Current direction and recorded amendment |
|---|---|
| Vue/TypeScript, Vite, Router, Vue Query | Retained. Express-hosted Vite middleware/HMR supplies normal development; manual-refresh watch builds were a spike deviation, subsequently corrected. |
| i18next with i18next-vue | Retained. The original thin provide/inject alternative was conditional on the selected binding failing its proof; D1 restores the primary binding after an unapproved substitution. |
| Authored OpenAPI 3.1; generated declarations and Ajv standalone validators | Retained. One root package/lockfile; no handwritten copies of wire shapes, second validation language or runtime schema compilation. |
| Reusable Bootstrap-compatible controls with suitable Reka primitives | Retained. Dialogs/tabs use Reka; mixed native navigation disclosures have a documented fit assessment in the framework record. |
| Same-component scoped SSR/hydration for established fallbacks | Retained as the rendering architecture. The Oct8 amendment supersedes mandatory interactive no-JavaScript operation; Help remains readable/searchable without JavaScript. |
| Monotonic Packing revision and retained old fingerprinted assets | Superseded by D2 and D5 below. Original rationale remains historical; no silent rewriting of those decisions. |
| Existing controller/business owners and pure DBAL | Retained and strengthened by the current shared-backend correction. Transport adapters must not become separate policy owners. |
| Enable a complete interface catalog without requiring a translated Help corpus | The earlier pilot required complete localized Help instead. The direct Oct12 decision restores English fallback for missing localized content and requires visible disclosure; complete localized Help remains the preferred outcome. |

### Authorized rectification (2026-10-07)

The existing decision ledger records maintainer approval of D1–D5. Preserve these amendments and their effects;
the [review](PILOT_PARITY_REVIEW.md) distinguishes recorded authorization from execution evidence.

| Decision | Approved behavior |
|---|---|
| D1: translation integration | Restore i18next-vue around the typed shared i18next translator; prove request isolation, hydration and reactive locale changes. |
| D2: concurrent changes | Replace unreleased Packing revision columns with touched-current-value comparisons under existing locks, including useful setup fields. Preserve unrelated changes and drafts; retain atomic capacity/assignment checks. No relationship revision history or live-editing infrastructure. |
| D3: contract version | Correct unreleased v1 in place, without another pilot API version. |
| D4: uncertain commands | Reconcile through reads without operation tracking or automatic replay. A read cannot determine the outcome of an unknown creation; retain input and explicit review/acknowledged departure. |
| D5: replacing a release | Support current-binary-folder replacement without old assets or additional operator steps. Session refresh detects updates; compatible edits may finish, an idle clean view reloads once, and missing chunks/incompatible commands retain mounted drafts. |

D2 tokens describe current values rather than a monotonic history. A value changed away and back can therefore
match an earlier comparison. Financial revisions and reviewed recommendation fingerprints retain their separate
guarantees. D5 cannot promise every old browser can submit indefinitely after replacement.

### Authorized migration amendments (2026-10-08)

- Preserve native business behavior and nearly identical UI/UX except for explicit migration amendments.
  Backend changes serve the migration through shared operations, projection and transport.
- Complete Help/Packing and necessary shared entry journeys. Overview and other scaffolds retain explicit TODOs;
  implemented portions still satisfy behavior, modularity and readability requirements.
- Interactive migrated pages require JavaScript and display a clear shared message or genuinely read-only result
  when it is disabled. This supersedes the original interactive fallback and Packing-card-image obligation.
- Keep prospective maintainer guidance staged and merge it into existing canonical owners only at authorized cutover,
  reconciling intervening changes. Language choice has one global user guide per language.
- Healthy shared reads use a 30-second cadence. Eligible recovery targets convergence within roughly one minute,
  retaining server cooldowns, visibility and observer disposal rather than the earlier generic two-minute delay.

### Authorized progressive delivery amendment (2026-10-08)

Overview SSR waits for session bootstrap and renders the interactive shell. Independent active regions read in
parallel and render as ready; a slow region cannot withhold a ready sibling. Closed hidden regions start on opening.
Unknown membership never claims zero or an empty result.

Use shared skeletons only while required scoped data is missing and pending. Retain readable data and drafts during
background reads; validated denial retires private content. Locale-owned bodies must match the selected language.
Read-only Help retains complete SSR. The renderer makes no self-HTTP requests.

### Authorized parity and shared ownership amendment (2026-10-08)

Entry admission, canonical destinations, forms, confirmed feedback, navigation and departure protection are
shared responsibilities. Feature consumers supply data and existing policies; preserve deliberate exceptions,
including surveys' admission/permission behavior.

The original native duplicate submission returned login to ordinary creation. The approved amendment returns to
the exact entity's duplicate URL through the shared guest-flow owner and all existing creation-form consumers.
It grants no new creation or duplication permission.

### Authorized bounded archival repair (2026-10-12)

The Oct8 deferral of broad locking/race hardening remains. The recorded exception for `IMP-042` retains the prepared
event/standalone-activity automatic-archival deadlock repair: acquire the existing primary root lock before the
conditional write and retain it in the existing transaction. Its cost is one lock read per candidate and an explicit
transaction for standalone activity candidates. Preserve eligibility, pause state, affected-row counts and deletion
boundaries. This is no authority for a wider locking redesign.

### Current approved correction boundary (2026-10-12)

The maintainer directly resolved the reopened review:

- Refactor shared backend behavior inside existing controllers using the migration requirements as the base.
  Native and v1 adapters translate their own requests/results and can be removed independently at retirement.
  Business policy has one owner; no new parallel controller or business service is introduced.
- Define method permissions centrally in the owning controller and make pilot authorization match native behavior.
  Record inherited permission inconsistencies in the native defect backlog; their presence does not authorize an
  unrelated native policy change.
- Preserve native English Help unchanged. Existing new English/German Help becomes reviewed release-owned runtime
  content under `docs/user-guide/en/` and `docs/user-guide/de/`. Staged maintainer resources are never runtime input.
- Keep the explicitly approved exact duplicate-return amendment.

Native behavior, guide prose/assets and unrelated implementation remain the comparison reference.
These specific backend/Help/form corrections grant no default-route cutover or native redesign.
The earlier structural relocation retained separate paths. The full authorized sequence now shares Packing
creation, metadata, item/membership writes, counters and setup through named existing-controller operations,
with central method permission definitions consumed by native/v1. Existing administration/event/image owners
supply their shared operations. Adapter coercion, response/feedback and conditional-write differences remain explicit.
Final acceptance and evidence for the approved coexistence remedy are recorded in the paired review.

### Direct completion and editorial decisions (2026-10-12)

The maintainer authorizes the full reviewed implementation sequence and resolves its two remaining decisions:

- Documentation cleanup is permitted. The freeze prevents pilot behavior from entering live native guidance;
  editorial consolidation may retire completed plans/history and repair references. Technical migration amendments
  remain staged until authorized cutover. Native guide prose/assets remain the visual and behavioral comparator.
- Complete localized Help is preferred for each additional interface language. Missing locale corpora, articles or
  figures fall back to the reviewed pilot English corpus with a visible localized notice and English result markers.
  Keep the chosen interface language; expose the actual content language. Unsafe existing translated source fails
  validation and is never hidden by fallback. This supersedes the prior implementation's complete-corpus requirement.

This authorization covers the bounded corrections and editorial cleanup; final implementation/evidence is recorded
in the existing review. Unrelated native permission, ordering or layout defects still require direct approval.

### Explicit canonical-location and action decisions (2026-10-12)

The maintainer restores all user Help to `docs/user-guide/`, with native root files beside localized catalog directories.
The first correction applied a mistaken directory name without resolving its conflict with the existing canonical
path. The subsequent explicit maintainer correction restores the original name and requires concrete conflict
inspection, measurable engineering checks and reviewed agent compliance. Cleanup explicitly removes the unused
obsolete controls illustration and the maintainer-only Activity Help paragraph; it grants no UI redesign.
The separate pilot Help destination was unauthorized; it is removed rather than treated as an approved design change.
Policies, ADRs, backlog, durable feature references and migration-only records now follow their explicitly defined
categories in the [central documentation policy](../policies/DOCUMENTATION_POLICY.md). This is an authorized
classification correction, not a change to the original technology or trusted-release-content choices.

The bounded native assignment root-S-before-item-X remedy is explicitly approved; it retains parallel assignments and
v1 root/reorder protection. The public-action decision preserves native per-method grants where the security/design
review finds no unintended protected-resource access and no prior stricter requirement. The review found no blanket
v1 profile-minimum requirement. Minimal method baselines and admitted context binding avoid exposing broader private
projections; principal-required native operations retain that requirement. Broader permission review/rework is backlog
scope, not authorization to change native policy during this correction. Execution and remaining limits belong to the
[paired review](PILOT_PARITY_REVIEW.md).

## Architecture and logical ownership

The diagram/owner table describes the implemented shared-operation boundary. Final execution and independent
acceptance remain separate; the current review owns execution evidence and its limits.

```mermaid
flowchart LR
    O[Authored OpenAPI] --> T[Generated declarations and validators]
    L[Shared locale catalogs] --> U[Vue controls and features]
    L --> C[Existing controllers]
    T --> U
    T --> A[Native and v1 adapters]
    U --> Q[Scoped query snapshots and separate drafts]
    Q --> A
    A --> C
    C --> D[Pure DBAL transactions and persistence]
    C --> S[Request-local Vue SSR]
    S --> U
```

| Owner | Responsibility and boundary |
|---|---|
| Existing controller | Named shared operation, authorization, business validation, orchestration and contextual errors; locked checks execute inside DBAL-managed transactions. |
| Native/v1 adapter | Decode operation-specific input and present its response/feedback; share controller policy without forcing identical transport or conflict protocols. |
| DBAL service | Queries, locks, transactions and persistence; no API/UI errors or moved business rules. |
| Feature page/API owner | Concrete workflow, generated operation/validator, query dependencies and feature policy; no ORM/session serialization or infrastructure copies. |
| Shared components/composables | Repeated visual/accessibility, admission/read/command/draft/feedback behavior; explicit contracts, with no hidden feature authorization. |
| App/query/locale owner | Request-local SSR, identity isolation, routing, shared transport and translator; no second server-data store. |
| Runtime Help corpus | Reviewed release-shipped articles/images per language; separate from native content and staged maintainer drafts. |

Shared type-only contracts belong in `src/types/*.d.ts`. Import contracts directly rather than through forwarding
modules. Optional feature render state uses renderer `data` and explicit Pug arguments, not another `res.locals`
channel. Purposeful comments explain nontrivial policy, concurrency, data flow and DOM hooks; named operations,
neighboring formatting and logical blank lines are acceptance criteria.

TanStack Query owns authorized server snapshots, feature drafts own original/local/remote values, and Router owns
durable navigation. Packing's browser-local Packed? checklist retains its existing storage keys and value.
Do not generalize financial review, recommendation or lifecycle policy into a universal CRUD/conflict engine.

## Build, migration and acceptance

One package workflow generates contracts/catalogs, checks server/client/SSR scopes and builds isolated legacy,
Vite client and SSR outputs. Express owns development requests with Vite middleware/HMR; production loads matching
built artifacts without a development server. Generated output remains ignored and is never hand-edited.

Migrate one authorized route family at a time through the [single contribution recipe](staged/DEVELOPMENT.md#implementing-the-next-feature-slice).
Preserve the native comparison and unique assertion boundaries while reusable controller operations serve both
frontends. Later retirement removes adapters/legacy consumers after complete feature parity and explicit cutover.

Use the cheapest stable checks with unique detection value. Persistence, authorization, privacy, destruction,
actual concurrency and hydration each require their relevant boundary. Builds or captures alone do not establish
visual/behavioral parity; compare the same actors/data on desktop/mobile and report limitations honestly.
Documentation reports remain advisory.

| Record | Single ownership |
|---|---|
| [Framework](../decisions/DEC-006-FRONTEND-FRAMEWORK.md) | Technology comparison, primitives, SSR and development integration |
| [API](API_CONTRACT_DESIGN.md) | Authored wire contract, generated consumers, adapters and conditional requests |
| [Refresh/conflicts](REFRESH_CONFLICT_DESIGN.md) | Read lifecycle, drafts, unknown outcomes and identity/cache boundaries |
| [Localization](LOCALIZATION_DESIGN.md) | Shared catalogs, locale resolution, runtime Help and future localization |
| [Pilot](FRONTEND_PILOT.md) | Current source/routes/build scope and limits |
| [Review](PILOT_PARITY_REVIEW.md) | Current findings, unique historical lessons and actual final verification |

Original feature inventories remain intact. Completed execution sequences are retired; Git preserves their detailed
history rather than a second maintained archive. Full migration, benchmarks, production cutover and live provider/
email verification are not established by this design.
