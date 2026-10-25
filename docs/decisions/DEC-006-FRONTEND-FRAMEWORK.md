# DEC-006: Frontend framework decision
<!--
documentation-metadata
audience: maintainers; frontend developers
owner: frontend maintainers
status: current
last-verified: 2026-10-25
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: Original framework/interface decisions and deferred targets retained; authorized P11 cutover scope and lasting amendments preserved; source ownership reconciled without final acceptance or deployment claim
source-anchors: package.json; vite.config.mts; src/app.ts; src/modules/frontendDevelopment.ts; src/modules/frontendRenderer.ts; src/frontend/; contracts/api/v1/; scripts/generate-api.mjs; src/modules/api/transport.ts; src/modules/localization/translator.ts; src/routes/api/v1.ts; docs/ARCHITECTURE.md; docs/DEVELOPMENT.md; docs/TESTING_GUIDE.md; src/routes/api/v1/
next-review: frontend-technology-or-rendering-boundary-change
-->

## Decision and scope

Use Vue 3/TypeScript, Vite, Vue Router and TanStack Vue Query while Express retains HTTP/session/backend ownership.
Keep Bootstrap-compatible appearance, native controls and suitable Reka UI primitives behind app-owned components.
Use shared i18next resources with primary i18next-vue binding and typed translator.

This is the original selected stack. It is not a benchmark or a claim that library defaults satisfy Surveyor's
permissions, capacity, revisions, financial reviews, accessibility or private-cache boundaries.
The dated choices below retain their original rationale and approved amendments.
General contribution and module rules belong to the active [Development Policy](../policies/DEVELOPMENT_POLICY.md);
applicable temporary profiles are discovered through the [Documentation Policy](../policies/DOCUMENTATION_POLICY.md#document-roles-and-optional-task-profiles).

## Authorized fallback and scope amendment (2026-10-08)

The original rendering decision required same-component SSR/native forms for established no-JavaScript flows.
That historical rationale remains: a static-only SPA could not preserve them.

The approved Oct8 amendment supersedes mandatory interactive no-JavaScript operation.
Interactive component routes require JavaScript and display a clear shared message or genuinely read-only result.
Same-component SSR/hydration remains; Help retains readable/searchable no-JavaScript GET/search.
Progressive Overview loads independent active regions after session-authorized shell rendering.
The later refined Req6A startup delivery clarification (2026-10-13)
retains Vue SSR and same-tree hydration while initial interactive content uses shared skeletons. Genuinely functional
static content remains available; JavaScript-dependent controls wait for initialization and failure has an independent
visible notice. The original choices above remain historical rationale, not permission to expose dead controls.

## Why this fits the repository

Surveyor already has template composition, typed browser modules, shared UI owners and pure domain/presentation
modules. Vue's SFC/template model preserves familiar HTML while moving interactive composition into one owner.
Express keeps existing controllers/services/sessions/deployment rather than adopting a second application server.

Keep client, SSR and server build outputs separate according to their runtime consumers.
Preserve the actual rendered Bootstrap/style baseline; installed package versions alone do not prove visual parity.
Reuse browser-safe domain owners directly, without barrels/forwarding modules.

## Alternatives considered

The original comparison used framework documentation and repository needs, not popularity or speculative speed.

| Candidate | Original assessment |
|---|---|
| Vue + Vite/Router/Query | Selected: typed SFC/template composition fits current HTML-oriented structure; integration still requires explicit routing/SSR/state/controls. |
| Svelte + Vite or SvelteKit | Strongest alternative: compile-time reactivity and Kit conventions are viable, including a custom Express host; adapting load/action/routing ownership adds integration scope. |
| React + Vite/router/query | Viable: typed JSX/composition, but another authoring model with no established repository/team advantage to offset it. |
| Angular | Viable: integrated routing/DI/typed forms, but broader conventions replace more of Surveyor's lightweight organization than reviewed needs justify. |
| Solid | Viable: signals/JSX/router, with equivalent integration/testing decisions and no demonstrated requirement advantage here. |
| Pug plus enhancement library | Rejected for interactive presentation: retains separate server/client presentation rather than one component owner. |

Primary references: [Vue SFC](https://vuejs.org/guide/scaling-up/sfc.html),
[Svelte TypeScript](https://svelte.dev/docs/svelte/typescript),
[SvelteKit custom server](https://svelte.dev/docs/kit/adapter-node#Custom-server),
[React application guide](https://react.dev/learn/build-a-react-app-from-scratch),
[Angular typed forms](https://angular.dev/guide/forms/typed-forms),
[Solid reactivity](https://docs.solidjs.com/concepts/intro-to-reactivity).

SvelteKit static SPA mode disables SSR; under the original fallback obligation that configuration could not
supply personalized native pages. This historical comparison is a configuration constraint, not a claim of Svelte
incompatibility or restoration of the superseded interactive obligation.
[SvelteKit SPA](https://svelte.dev/docs/kit/single-page-apps)

Do not add Nuxt merely for Vue SSR: Express already owns the relevant responsibilities and the renderer is bounded.

## Rendering and route ownership

Express explicitly authorizes recognized document routes. Request-local Vue SSR uses the same component tree,
router/query/locale state and controlled bootstrap; no self-HTTP or global private cache.
The browser hydrates and uses typed JSON/multipart inside admitted component route families.
Initial interactive versus static output follows the delivery clarification above; it does not remove the SSR build,
production dependencies or request-local rendering ownership.

Preserve provider/token/email/print/download document boundaries.
No wildcard HTML handling for APIs, missing assets or exports.
[Vue Router history](https://router.vuejs.org/guide/essentials/history-mode.html)

Complete component ownership prevents scripts from competing over one subtree.
SSR HTML alone cannot prove active hydration.

### Direct ordinary SPA reinforcement (2026-10-16)

During the Event permission/transport review, the maintainer rejects D1's proposed retention of ordinary Event
creation/duplication document POST as contrary to the SPA rewrite. The reply reinforces the original generated
JSON/multipart command and client-navigation choice and requests correction of equivalent implemented P0–P2 Vue
forms/links, with an explicit plan and prevention guidance. Existing implementation, agent descriptions and passing
document-form tests supply no retrospective exception approval.

The original provider/token/email/print/download boundary above concerns true external arrival and its established
capability admission/consumption, external handoff or output. It does not exempt an internal token-issuance action,
profile transfer/destructive command, Event creation or current child-deletion control from ordinary SPA transport. Keep explicit issuance out
of Query refresh, prefetch and history replay, and retain private capabilities only within their admitted lifetime.
Preserve genuine initial/native compatibility entries and modified-click destinations. Existing backend operations
retain their order and possible partial completion; no new atomicity, replay or excluded token/identity remedy is
authorized by transport adaptation. Current implementation and renewed application evidence remain separately reviewed.

The same reply resolves E1 by excluding simultaneous native/Vue production use and directs no Event permission
coordination repair for that scenario. The temporary native development comparator, separately mutable native/Vue
presentation, matching shared Vue owners and previously approved Packing coordination remedy remain. This bounded
current-phase correction does not authorize later phases, default-route cutover, publication or native removal.

## Shared components without a redesign

Retain dark Bootstrap geometry, labels/order, responsive tables, focus and meaningful native controls.
Wrap repeated visual/accessibility behavior with explicit app-owned props/events, rather than one wrapper per tag or
a themed widget suite. Feature composites remain separate where survey/assignment/finance semantics differ.

The original choice uses Reka for dialog/confirmation/menu/combobox wrappers where primitives fit.
Dialogs/tabs use its focus/keyboard owners. Mixed native links and embedded controls use the shared disclosure
wrapper: public Reka menus introduce registered items/roving-hover focus, Popover introduces dialog/autofocus/
positioning behavior, and DismissableLayer is not a public export. Those differences do not fit unchanged native
navigation. This bounded fit assessment retains the conditional choice rather than silently substituting a stack.

[Reka accessibility](https://reka-ui.com/docs/overview/accessibility),
[dialog](https://reka-ui.com/docs/components/dialog)

Native inputs/checkboxes/selects/semantic tables remain appropriate.
Avoid simultaneous Vue and Bootstrap plugin DOM ownership. Exceptional legacy wrappers must isolate their subtree,
own listeners/transitions/focus and dispose fully.
[Bootstrap JavaScript](https://getbootstrap.com/docs/5.3/getting-started/javascript/)

BootstrapVueNext remains a reasonable alternative, not rejected by a stale maturity label.
Adopting a broad widget set still needs Surveyor's policy/draft/markup layer; any departure from the selected strategy
requires a demonstrated maintenance benefit and direct approval, without mixing libraries screen by screen.

## State, forms and localization

TanStack Query owns authorized snapshots, feature composables own unsaved drafts and Router owns URL state.
No initial Pinia mirror store. Capabilities remain server projections; every controller write reauthorizes.
Generic controls receive data/events/injected operations without feature endpoints or permission decisions.

Use normal bindings and field-owned normalization, generated constraints and shared command/recovery behavior.
No second validation language/schema-driven universal form engine.
Identity retirement, polling, current-value comparisons and separate financial/recommendation guarantees remain
owned by their shared consumers and domain contracts.

Shared i18next serves browser/server wording. The original provide/inject fallback was conditional on the primary
binding failing its proof. An earlier implementation selected that fallback without established authorization;
the approved 2026-10-07 amendment restores i18next-vue.
Preload request-local central resources and prove locale isolation/hydration/reactivity.
[i18next-vue SSR](https://i18next.github.io/i18next-vue/guide/ssr.html)

### Authorized comparison and uncertainty amendments (2026-10-07)

The original Packing design used a monotonic revision. The approved amendment replaces it with touched-current-value
comparisons under existing locks, preserving unrelated fields and local drafts. A value changed away and back can
match earlier evidence; financial revisions and reviewed recommendation fingerprints retain their separate guarantees.
The unreleased v1 contract is corrected in place rather than adding another version.

Unknown commands recover through admitted reads and deliberate review, without operation tracking or automatic replay.
A read cannot establish the outcome of an uncertain creation. Retain its input and require an explicit decision before
leaving or submitting again. These bounded choices preserve separate shared controller and persistence responsibilities.

## Shared API contract decision

The original foundation selected authored OpenAPI 3.1.1 with JSON Schema draft 2020-12 as the wire-shape authority.
Redocly lints/bundles local references; openapi-typescript generates declaration-only contracts; strict Ajv 2020 with
ajv-formats compiles standalone server/browser validators; openapi-fetch consumes the generated paths. The bounded
HTTP adapter binds that generated policy to Express without becoming another controller or routing framework.
Generated validators carry their runtime helpers; schemas are not compiled in the browser or at application startup.
One root package/lockfile owns dependencies and exact versions.

The original Express OpenAPI Validator alternative would add a second runtime validation configuration alongside
the browser compiler. The selected shared standalone pipeline avoids that duplication in exchange for the small
app-owned transport adapter. The schema preference favors explicit shapes, local references and simple tagged
unions over recursive polymorphism, arbitrary maps, deep composition or executable custom vocabulary. Existing
password UTF-16 minimum semantics and raw existing-item capacity values are bounded native-preserving extensions,
not permission to introduce a second validation language or generic coercion.

Original interoperability choice: [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html),
[openapi-typescript](https://openapi-ts.dev/introduction),
[Ajv standalone](https://ajv.js.org/standalone.html),
[openapi-fetch](https://openapi-ts.dev/openapi-fetch/).
These links record the selected approach rather than a claim about the newest specification or library version.
Current authoring and released-version compatibility procedures belong in the Development Guide.

### Authorized transport scope restoration (2026-10-14)

**Superseded agent interpretation:** the account below extended removal of unused implementation into definition
restrictions. The maintainer's 2026-10-15 correction below resolves that overreach; the original account remains as history.

**Historical account correction (2026-10-15):** the original selected API design at `2dfa2573c64178f54684cc4877b5a945f66e24c8`
explicitly included declared repeated query arrays and binary/text outputs. Their implementation appeared in the
2026-10-08 correction. An earlier agent account incorrectly treated them as outside the original design because
the inspected current endpoints had no production consumer. Absence of a consumer did not negate that selected
capability or establish missing design authorization.

The maintainer separately approved removing repeated-query-array support and unused plain-text API output during
the readiness work. That is an explicit narrowing of the originally selected runtime scope in the existing
generator and transport owner, not restoration of an originally scalar-only design.
JSON body/response arrays, existing API operations, native document/download boundaries and shared business behavior
retain their existing contracts. The approval grants neither another transport style nor a new frontend framework.

#### Maintainer correction (2026-10-15)

The maintainer explicitly clarifies that the approval removed unused implementation only. It did not authorize
generator bans on parameter schema shapes or response media definitions. Treating the earlier removal as approval
for those restrictions was agent overreach; the maintainer directs their removal.

Authored definitions may use arrays, objects and unions and declare response media such as `text/plain`. Generation
must not reject them solely for those shapes or media. The existing HTTP decoder still binds single scalar
path/query/header values, and runtime repeated-query-array decoding and plain-text response delivery have not been
restored. Generated contracts, metadata and validators do not by themselves implement those HTTP behaviors.
Existing serialization/metadata mechanics and strict schema validation retain their own scope.

### Approved finance wire correction (2026-10-20)

The original selected API design at `2dfa2573c64178f54684cc4877b5a945f66e24c8` requires decimal-string numeric
identifiers, fixed-two-decimal money strings and four-place decimal factors. Editorial consolidation in `e80a512`
incorrectly described the money/factor choices as future work, without a corresponding approval. P7 (`584cd22`)
and P8 (`3f1fba7`) followed the native numeric payload shapes instead. Investigation found no substantive reason
requiring JSON numbers. Existing permissive positive-amount validation explains retaining accepted command input
precision; it does not authorize a different wire format or establish a financial calculation defect.

The maintainer explicitly approves R2 as correction of that mistake, including the original fixed-two-decimal
command-input rule's amendment to retain precision already accepted by shared operations. Money command values
are plain decimal strings without exponent notation; saved read money uses the existing shared fixed-two-decimal
presenter. Factors retain canonical four-place strings and existing sign/range/precision rules; numeric record
identifiers retain positive decimal strings. Browser encoding preserves meaningful entered digits without changing
the visible lexical draft. Existing server normalization, calculations and persistence remain authoritative;
native transport and frontend behavior stay unchanged. The existing compatibility family/update-required recovery
protects older loaded clients and mounted drafts. Implementation and executed evidence remain separate from approval.
The same authorized original-baseline audit restores Activity role/override identifiers and identifier arrays to
the already selected decimal-string rule. Its existing frontend requirements argument adapter serves both local
analysis and calculation while the shared engine retains numeric internal identifiers; no domain model changes.

## Deferred localization and domain integration targets

These original target choices are preserved as **intended, not implemented**. The current pilot localizes UI/API
text and reviewed Help through shared catalogs, plain text/cardinal plurals and a server-issued browser preference
cookie. It does not persist language on User/Guest or fully localize Pug, invoice wording, email or PDF output.
This record preserves decisions and supplies no authorization to implement those future capabilities.

The intended persisted preference belongs to the operating User/Guest rather than participation profile/event/pool.
Profile switching retains that principal's choice. Guest-to-account migration may inherit a guest preference only
when the destination has no explicit preference. A future principal-language command must preserve live drafts on
failure; an explicit output-language override changes presentation only, never access or selected records.

Future email uses the recipient's preference, then the identity-creation initiating language when no preference
exists, then the shared default. Queued mail/PDF captures each recipient's locale/formatting context before async
work so retry cannot change the wording. Rich named slots, grammatical context/ordinal forms, regional formatting
and additional scripts/fonts remain separate unsupported extensions; messages cannot silently introduce them.

Future financial frontend integration preserves explicit reviewed preview/refresh rather than generic polling or
rebasing of reviewed values. Recommendation/job consumers retain their established backoff/expiry/terminal protocol.
These intended frontend integrations leave existing financial revisions, signed evidence and activity fingerprints
with their domain owners; the 30-second shared-read policy is not a replacement for those contracts.

**Implementation status (2026-10-22):** The preceding paragraphs preserve the original target status. P6 now
supplies recommendation snapshots and known-job observation through pure reads; P9 now supplies explicit reviewed
finance previews and saved settlement/output workflows. Domain-job timing, financial revisions, signed settlement
evidence and recommendation fingerprints retain their existing owners. Principal-language persistence and full
email/PDF localization remain unimplemented targets. This status correction supplies no new implementation authority.

## Approved interface and shared SPA amendments (2026-10-19)

The maintainer directly approves controlled Vue elements in translated messages (R3). This supersedes the rich
named-slot deferral recorded above for explicitly declared, validated placeholders filled by authored application
components through the selected shared i18next-vue owner. Catalogs remain non-executable: arbitrary HTML, undeclared
slots, grammatical context/ordinal extensions, principal-language persistence and new output-localization slices
are not authorized by this amendment. The original deferral remains visible as history.

The same direct reply requires all non-user-generated migrated UI text to use the shared catalogs (R2),
locale-neutral responsive usability rather than a German-only layout change (R4), and integrated Refresh through
existing read owners (R6). Functional visual parity preserves the information and steps available to users rather
than exact pixels, DOM IDs or internal naming; explicit requirements and approved changes are exceptions by default.

R7 supersedes inherited local feedback reveal and feature-specific notice placement. Shared SPA notifications
serve page/dialog consumers without submission- or refresh-induced focus/scroll changes. Meaningful status,
receipt renewal/expiry, uncertainty, drafts, accessibility and controller-owned business behavior retain their owners.
These approvals cover implemented migrated modules; they grant no later feature phase, native-source change,
cutover, backend business redesign, publication or deployment. Implementation and verification are separate evidence.

## Build and development integration

Keep root package/lockfile and existing release shape. Vite emits separate client/SSR artifacts.
Explicit browser/bundler/server/SSR scopes prevent Node imports entering client output.
vue-tsc checks SFCs separately from Vite compilation.
[Vite backend integration](https://vite.dev/guide/backend-integration),
[Vite SSR](https://vite.dev/guide/ssr)

Express-hosted Vite middleware/HMR implements the original normal-development choice.
The earlier manual-refresh watch substitution was corrected. Serialized authored contract/catalog regeneration
restarts Express only after completion. Production runs coherent built artifacts, not Vite.
Externalized SSR dependencies remain production dependencies; generated outputs stay ignored.

The approved 2026-10-07 release amendment supersedes retained-old-asset deployment: current-folder replacement, ordinary session update detection,
compatible loaded edits, one clean idle reload and preserved mounted drafts for missing chunks/incompatible commands.
No additional operator protocol is introduced.

### Authorized automatic document reload scope (2026-10-15)

During the frontend-readiness review, the maintainer explicitly limits automatic full-document reloads to pages
whose displayed content can change dynamically, such as lists. The current eligible routes are Overview and Packing
detail. Creation, duplication, user-management and Help pages are excluded, including an untouched form. A static
admitted error or completion on a dynamic route is also excluded. Subsequent dynamic feature routes declare their
eligibility through the existing route metadata and shared update owner; new pages do not inherit permission to
reload automatically.

This narrows D5's original clean-idle-page rule while retaining current-folder replacement, compatible mounted
commands, draft/pending/unknown protection, initialization safety and the one-attempt loop marker. Detection of a
changed release or missing chunk still exposes deliberate recovery on an excluded page. Deliberate recovery retains
its existing consent and command guards. The amendment concerns replacing the whole document; it does not change
periodic content reads or session/security revalidation. No native UI/backend change or default-route cutover follows.

## Verification required for implementation

Use focused server/client/SSR/test compiler/build checks, mounted draft/read/command consumers, real persistence
where locking/authorization requires it and selected browser routes/focus/hydration/source integration.
Accessible primitives are not certification: preserve semantic labels, keyboard/focus, zoom/localized text and
small-screen behavior.
[Vue accessibility](https://vuejs.org/guide/best-practices/accessibility.html)

Compare affected scenes against approved behavior with equal data/actors/viewport and disclose intended changes.
Named shared operations and controller-owned method policy are implemented. Shared-action declarations originally
served native factories alongside v1 consumers; the retained controller and v1 policy/capability owners continue to
use those declarations after native factory retirement.
Current verification selection belongs to [Testing](../TESTING_GUIDE.md).
No bundle-size or framework benchmark is claimed by this decision record.
Documentation reports remain advisory.

## Preserved migration decisions and cutover (2026-10-25)

The maintainer directly requests full P11 implementation, regression testing and comparison with the last recorded
native screenshots. This authorizes default-route adoption, native browser retirement and publication of independently
reviewed prepared guide bytes under the existing P11 contract. It does not authorize deployment or the excluded
general backend remedies. Earlier phase-only limits describe their original checkpoints; this instruction supplies
the later cutover authority without changing those earlier approvals.

The completed temporary design and review records are retired after their lasting contracts enter the existing
Architecture, Development, Testing, operator guides and this decision record. Detailed historical evidence remains
in Git and ignored run artifacts. The following amendments preserve decisions that outlive their temporary owners;
they describe authorization and intended boundaries, not fresh test results.

| Date and decision | Preserved contract |
|---|---|
| October 8, refresh and progressive delivery | Healthy eligible shared reads use a 30-second cadence with bounded recovery, visibility/cooldown/disposal guards and independent Overview regions. The October 13 startup amendment supersedes initial interactive controls with shared skeletons; mounted readable data and drafts survive background reads. |
| October 8, duplicate return | Login returns to the exact requested duplicate destination through the shared creation-flow owner. This changes no creation or duplication grant. |
| October 12, shared backend and per-method permission | Existing controllers own named business operations and centrally declared method policy; adapters decode/project only. Public methods retain existing public grants without exposing private projections or relaxing operations that require a principal. The bounded Packing root-before-item lock remedy and automatic-archival root-lock repair remain the recorded exceptions to the general backend-repair exclusion. |
| October 13, existing Event association | Selecting the existing Event association returns `changed: false` after current source and target permission checks, ignoring comparison-header evidence and writing nothing. Changed associations require the current relationship and reviewed comparison under the existing locks. |
| October 13, Packed storage failure | Packing may keep temporary mounted checklist state when local storage fails, with visible warning and explicit retry. It neither persists to the server nor promises restoration after the owner is retired. |
| October 13–15, identity and request-session ownership | Express's request Session remains the single writable request owner. The narrowly approved identity completion transaction prepares required output before commit and retains its exact callers. Ordinary admission reads current generation without introducing a mirrored request session, save interceptor or extra anonymous persistence. Existing account-required redirects may use the established one-time anonymous Session/flash behavior. |
| October 13, Help fallback | The initial individual-figure fallback was superseded by complete-article selection: a complete localized article with its own assets, or its complete reviewed English counterpart with visible disclosure. Invalid existing source fails normally. The canonical Help tree and DEC-004 trust boundary remain. |
| October 14, separate backend work | Migration reuses existing operation order and inherited partial outcomes. Current-owner token issuance/consumption, transfer completion, profile deactivation, account deletion and provider failure remedies remain separately authorized backlog work. A frontend consumer or passing test cannot approve them. |
| October 15–20, native isolation | During migration, native presentation was fixed and Vue presentation separately mutable, shared among matching Vue consumers. Backend/domain/catalog owners and common images stayed shared. That temporary native preservation obligation ends with authorized P11 retirement; simultaneous native/Vue production use was expressly excluded on October 16. |
| October 18, Survey presentation | Initial native parity kept saved voting descriptions hidden and duplicate descriptions empty, with first-occurrence selections. The separately approved R1/R2 exceptions display escaped saved instructions with line breaks and prefill the saved description/canonical recurrence values when duplicating; ballots and header images remain excluded. Survey retains its distinct permission model without the general permission matrix. |
| October 19, recommendation observation | Automatically started recommendation jobs may be observed through pure saved-state/status reads. Explicit workspace entry, Reload and generation/application completion retain their recorded maintenance triggers. Observation cannot enqueue additional work or replay generation. |
| October 20, civil days and saved-slot count | Activity counts every admitted saved slot independently of the current filter. Event/Activity date-only labels and Activity weeks share the civil-date owner, superseding native timezone-dependent presentation; stored days, business calculations, timestamps, assignments and print outputs retain their meaning. |
| October 20, Activity swaps | New local swap legs keep their explicit pair identity. Saved rows may use a mutually unique reciprocal counterpart; ambiguity requires the organizer's choice before review changes. Pair metadata stays local and does not replace the server's reviewed-batch contract. |
| October 20, Finance public methods | Pool management, assignment/adjustment/organizer coverage and ordinary invoice acceptance/decline/organizer close honor their established public method grants. Organizer expenses, retroactive changes, participant operations and private finance reads retain their existing identity requirements. |
| October 23, composing Enter | Shared inline editors and Activity role entry ignore shortcuts during active composition. Ordinary Enter, mouse actions and blur keep their existing behavior. This deliberately supersedes inherited keyboard parity for those controls. |
| October 23, deletion delivery | Original departure consent expires when the first confirmed-delivery attempt settles. Retry consults current drafts again; retained delivery prevents another permanent deletion until its destination is resolved. Required reads/navigation may retry, DELETE never does. |
| October 23, Overview invalidation | Actual Query invalidation pauses lifecycle/deletion writes while cached cards stay readable. Navigation/filter/paging/expansion/Refresh keep their admission. Background failures and locale invalidation can prolong this pause; no separate freshness store is introduced. |
| October 23, Home and shared controls | Public Home remains distinct from personal Overview. Creation permission disclosures start closed while retaining mounted values; Survey remains excluded. Sticky notices reserve their natural height, shared Refresh/headings retain actual read admission, reorder previews retain one existing command, and generated diagnostics identify fields without duplicating validation. Explicit removal of saved former-participant overrides preserves ordinary omission protection. |
| October 24, feedback and contextual wording | Confirmed operations publish one common receipt; failed following reads/navigation retain recovery without write replay. Independent failures retain their actual identity. Responsive menus/actions and contextual translations use shared owners. Bounded error-cause metadata preserves existing controller reasons without changing status, operation order or business rules. |
| October 25, deactivation warning | English/German wording distinguishes deactivating the selected profile from deleting an account with no profiles remaining. Confirmation, permanence warning and existing uncertain completion stay intact; IMP-006 is not repaired by this wording correction. |

Production documents use the canonical paths, with Home at `/`, Overview at `/users/dashboard`, explicit feature
routes and retained compatibility entries. Provider/token arrivals, protected files, print and exports remain document
boundaries. Native interactive views, browser modules, browser styles and flat Help comparison content are retired;
standalone Pug print templates, print CSS, shared images, domain/controllers/DBAL, catalogs and required third-party
packages retain their actual consumers. The established API validator generator still uses esbuild independently
of the retired native browser pipeline.

Publication copies the reviewed prepared bytes verbatim. The release still contains coherent server, Vite client/SSR,
print and shared assets; it introduces no additional deployment protocol. Documentation checks remain advisory.

### Maintainer correction to cutover ownership and wording (2026-10-25)

The maintainer rejects the unapproved English rewording and mixed-domain route implementation, and explicitly
requires removal of production references to the pilot or other frontends. Restore the established English labels
and domain route composition: Express mounts domain routers explicitly, and Vue route records belong to matching
domain modules. Preserve ordering, shared controller/DBAL operations and genuine provider, token and output boundaries.

The same correction supersedes the compatibility-entry wording above. Remove unused rollout prefixes, Home aliases,
registration aliases and the unversioned proof alias rather than retaining a second route surface. Current versioned
proof downloads and actual document entry points keep their existing authorization. Production identifiers, selectors
and comments describe their present responsibilities. The earlier cutover request did not authorize the rejected
English or ownership changes; implementation and passing tests did not establish that approval.
