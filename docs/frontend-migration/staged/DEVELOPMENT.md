# Staged frontend development amendments
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-20
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: P0-P6 contribution owners reconciled with integrated Refresh, common non-jumping notifications, controlled component messages, locale-neutral usability, saved-slot totals and shared civil-date ownership with retained authority/draft lifetimes; execution separate; no publication
source-anchors: docs/frontend-migration/documentation-boundary.json; docs/frontend-migration/check-documentation-boundary.mjs; docs/policies/DOCUMENTATION_POLICY.md; docs/policies/DEVELOPMENT_POLICY.md; src/frontend/; contracts/api/v1/; scripts/generate-api.mjs; src/modules/api/transport.ts; src/modules/api/session.ts; src/modules/lib/session.ts; src/modules/lib/frontendSession.ts; src/modules/localization/translator.ts; src/routes/api/v1.ts; src/routes/api/v1/auth.ts; src/routes/frontendPilot.ts; tests/integration/frontend-session-admission.spec.ts; package.json; src/types/IdentityTypes.d.ts; src/types/FrontendPilotUiTypes.d.ts; src/modules/lib/civilDate.ts; src/types/CivilDateTypes.d.ts
next-review: next-authorized-migration-slice-or-cutover
-->

These amendments retain the reviewed frontend guidance without copying unchanged production procedures.
The [profile](../PROFILE.md) governs preparation and review; its [manifest](../documentation-boundary.json)
owns destination mapping and exact operations. Payload links use their mapped production location.
Surrounding notes use this file's location. Preparing complete temporary output does not authorize cutover.

## Components, contracts and browser state — amendment-01

<!-- delta:amendment-01 -->
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
| Matching detail read/command state to presentation | `useListDetail`/`useListCommands` retain lifetimes; `EntityDetailReadState`, `EntityListToolbar` and `CommandFeedback` render injected state/events without another query, draft or authority owner. |
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
the description. openapi-typescript emits declarations without runtime enums. Strict Ajv 2020 plus ajv-formats
compiles standalone validators and their required runtime helpers. Feature chunks load their own validators;
neither the browser nor server startup compiles schemas. openapi-fetch consumes the generated paths while
`app/transport.ts` supplies headers, runtime validation, cancellation and status classification, retaining the Response.
Types alone cannot validate received JSON. Do not introduce another schema language, validator configuration or router.

Use explicit scalars, object properties/required, arrays, local references, enums/const, bounds/patterns and simple
tagged `oneOf` unions. JSON null uses a type union rather than OpenAPI 3.0 `nullable`. Mutation bodies reject unknown
fields; browser response validation accepts compatible additions while error parameters retain their authored shape.
Separate create/update/read semantics and permitted projections. Avoid recursive polymorphism, arbitrary maps,
deep `allOf`, remote references and custom executable vocabulary; `readOnly`/`writeOnly` cannot enforce disclosure.
These shape preferences require author/reviewer judgment, not generator bans on arrays, objects or unions.
Strict Ajv validation still rejects unknown schema vocabulary. Do not disable strictness or enable coercion,
default insertion or additional-field removal. Timezone existence and cross-field business checks remain named
controller operations.

Two implemented constraints preserve existing field behavior. Registration/reset author
`x-surveyor-min-length-utf16: 8`, because native password validation counts UTF-16 units; ordinary JSON Schema string
bounds count code points, and passwords acquire no maximum. Existing-item capacity admits the number/string/null
primitive union and passes the raw scalar to the existing signed nullable SQL column. Database rounding/range/failure
remain authoritative; creation/new-item validation stays separate. Do not generalize either extension into coercion
or a copied database-limit policy. Native metadata diagnostics remain owned by their native adapter.

The current HTTP adapter decodes single scalar path/query/header values, JSON and Event/Packing/Drivers/Survey/Activity multipart, and
delivers JSON or scoped binary image responses. Creation decodes the `data` JSON part once against its authored nested schema
and handles `image` separately. Repeated query parameters, absent/empty values and malformed input stay distinct.
On the server, `receiveApiUpload`, `decodeApiMultipartData`, `decodeApiMultipartImage` and `sendStoredApiBinary`
in the existing transport owner share matching upload completion, multipart decoding and confined binary delivery.
All five feature adapters use these owners. Features still select their parser, byte/type/filename limits, generated
operation, authorized storage root, method admission, cleanup and controller; transport performs no domain write.
The browser's `createMultipartForm` in the existing transport owner supplies the matching creation/header envelope
for Packing, Drivers, Event, Survey and Activity. Features validate their own generated input and select the operation; the
serializer only encodes an optional `data` part and appends the original optional image bytes. Header operations
pass no metadata. It neither chooses an endpoint nor changes headers, comparison evidence or file lifetime.
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
icon, constraints, rows and required-marker policy explicitly. An omitted native field name uses `name=null`, distinct
from the default name derived from its ID. `FileField` composes the same label/control owner and the existing file
release composable; the feature retains its selected File and command/draft decisions. Rejected or unknown commands
keep that exact input mounted. Do not copy a chooser merely because its caller creates rather than edits an entity.
Read-only Packing/Drivers/Survey/Event/Activity descriptions use `EntityDescription` for escaped lines. Lists retain their
paragraph hook, spacing and optional divider; Event supplies an unnamed ordinary paragraph inside its own labeled
column. The shared owner does not add wrappers or copy a feature's draft. Survey ballot and result labels share the
answer appearance mapping while retaining their different wording.
`FormField` uses Vue's native input directive for composition/caret behavior while emitting the control's DOM string.
This preserves lexical Event capacity rather than silently adopting the directive's numeric conversion. Explicit
readonly/class inputs and the label slot preserve existing control presentation and Event's inline deadline hint;
field constraints and normalization remain with the feature.
Existing Event numeric/date fields and timezone pickers use the control slot where retaining the original native
directive or picker preserves coercion, lexical drafts or focus targets. Keep the feature's actual node and constraints;
the slot does not create another input model. Activity initial-slot text/time/number fields use that same slot so
every control has an associated visible localized label while its existing model, lexical capacity input and constraints
stay feature-owned. A placeholder is not an adequate label, particularly for native time and number inputs.
Matching Bootstrap command/filter buttons use `ActionButton` with their
existing variant, size, form and disabled policy. Passing only `disabled` retains a native no-spinner workflow; do not
add pending presentation merely because the shared component supports it. Durable feature warnings use `StatusNotice`,
with feature-owned content, visibility and warning intent rather than a new timer or command owner.
Its default live-region role follows the feedback kind. Pass an explicit null role only for an existing plain notice
whose contract has no live-region announcement, rather than silently adding accessibility behavior during composition.

`AppTabList` shares the native tab keyboard contract and Reka roving tab stops across Settings and Activity. Its default
presentation is pills; Activity supplies the tabs variant, IDs and panel targets. Arrow keys, Home and End activate
and wrap without scrolling, including modified keys. PageUp/PageDown retain browser behavior rather than Reka's extra
activation. Pages own admission and keep their dirty panels mounted; do not bind a broader command lock to Activity's
otherwise enabled tabs. Shared assignee lists likewise retain admitted names and removable IDs; feature-specific
remove controls may use the existing list's slot without copying list markup or changing server authority.
`AppAccordionButton` shares matching expanded/collapsed trigger presentation and initialized activation across Event,
Overview and administrator disclosures. Features retain which panel is open, panel markup, contents and reads; pass
their existing disabled condition and control target. A visual trigger never owns query admission or a draft.

Judge migration parity by the information, actions and steps users experience. Explicit requirements and approved
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
in the basic Activity phase, and printable schedules retain their authorized document destination.
Settings receive optional linked-Event/archive hints and export links through the existing settings/lifecycle owners;
defaults preserve other consumers. `FormField` accepts an explicit label target separately from its input ID/name
when the visible label targets a separate actual control, such as a timezone button. Neither presentation inputs nor client guards grant method
authority. The Activity Slots badge counts every admitted saved slot; All/My/Open only change visibility, and an
empty collection displays zero. Derive the total from that collection rather than DOM rows or another store.

Under the approved calendar-day policy, `src/modules/lib/civilDate.ts` is the pure shared owner of strict ISO civil
date parsing, selected-locale display and Monday-to-Sunday week grouping. Activity creation adapts its clipped day
arrays, and the versioned detail projection returns its structural `CivilDateWeek` values without another calendar
loop. UTC calendar stepping preserves saved days across timezone and daylight-saving changes, including a preceding
Monday in year 0999 for an admitted year-1000 plan. Event and Activity date-only presentation use this same owner;
feature adapters retain their existing invalid/absent fallbacks. Stored dates, domain calculations, native rendering
and printable output retain their existing owners. The original separate native browser/server algorithms remain
historical baseline evidence, superseded for Vue by the October 20 approval.

For advanced Activity, compose `ActivityRequirements` and `ActivityRecommendations` inside the admitted Rules tab;
changing tabs preserves their independent drafts. Requirements keep lexical form values and the saved calculation
context separate from refreshed snapshots. `requirements.ts` calls the existing pure requirements engine for local
coverage and baseline calculation, and `ActivityParticipants` renders both saved and unsaved progress. Structural
engine inputs and the shared `RoundingMode` declaration under `src/types/` keep ORM entity imports out of browser
compilation; this type boundary changes no calculation or database behavior.
Authored fallback names require explicit provenance before a presentation owner replaces missing raw text. Activity's
versioned callers opt into optional name-origin fields from the existing shared controller reads; native defaults
keep their established payloads. `activityParticipantName` translates only identified fallbacks or locally identified
absent names, never English-looking user text. Matching saved/live progress, search, override labels/sorting and
manual/staged recommendations adopt that helper. A staged row retains origin in its local declaration, while the
review serializer excludes both names and origin. Locale changes update presentation without rewriting those rows.
The form emits only its current mode for native-equivalent Auto control; it remains the sole requirement draft and
generation still uses saved server settings. Slot-role and manual recommendation editors retain valid selections
while clearing fields and IDs released by fresh admitted options. Dictionary keys from role titles remain data.

Recommendations keep their local rows, manual modal and frozen application batch in feature owners. Shared
command/query admission, warning presentation and dialogs retain their existing lifetimes. Entry, explicit Reload,
explicit generation completion and confirmed application deliberately reuse native maintenance; never place that
operation in Query, background refresh, retry or ordinary job-status reads. Pure recovery reads do not prove that an
uncertain dispatch failed. Poll only a confirmed job identity and stop on terminal, retired or denied context.
The approved automatic deadline-job observation also consumes an identity returned by entry. Its completion reads
saved proposals through a pure snapshot; only an explicitly dispatched generation retains the maintenance trigger.
Submit the identical previewed batch with its current overlap acknowledgement; existing server engines retain
generated/manual provenance, both swap legs and applied/skipped decisions. Keep job diagnostics private and pass
only explicit permitted scalar projections. Inherited postcommit regeneration failures remain outside this adaptation.

1. **Identify its actual contract.** Follow page admission, request parsing, controller decisions, DBAL and rendered
   controls. Include owner, guest and restricted actors; coercion; omission/null/false; no-op outcomes; destinations;
   feedback; focus; and hidden/empty/archived states. Peer features are evidence to inspect, not a universal policy.
   Classify every form and link, including shell, parent/context and destructive controls: ordinary migrated
   command/navigation, initial or external capability arrival, provider handoff, output/download or unmigrated
   destination. Inspect actual targets and side effects; an old anchor, token-related name or partial backend
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
   Pass that state to `ActionButton` (or its disabled/pending refs to a native control), and call its `isAvailable()`
   before dispatch. The control and handler must share this decision, including session revalidation and cooldowns;
   an enabled-looking action must not silently stop at an undisclosed read gate. `usePageEntry` and `useCommand`
   expose their own action states so callers reuse their lifecycle decisions. Keep read admission
   in the read owner: session recovery must remain available while ordinary reads wait, local Cancel/draft controls
   need no read admission, and already admitted commands retain their captured completion lifetime. This derived
   state stores no drafts, server data or authority and never retries an operation automatically.
   Reevaluate already-open dialogs when method grants change: readable content and local drafts may remain, while
   dispatch controls must show the same current availability as their handlers.
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
   database version and SQL mode before interpreting persistence-dependent outcomes; preserve the shared native
   behavior and diagnose environment differences without introducing validation solely to satisfy a local fixture.
   Exercise actual click and keyboard targets too: wrapping descriptive checkbox text in a label changes activation
   even when the resulting screenshots are identical. Keep fixture focus equal, then compare focused states explicitly.

   Characterize incidental computed-style differences before changing a comparator. In Actions, the native button
   sits inside a form which is a flex item; the Vue button is itself a flex item, so the browser blockifies its
   computed display. Inspect the button's wording, availability, focus, painted hierarchy and reachable fit without
   turning that incidental computed value into a native DOM contract. Keep raw diagnostics, semantic links/actions,
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

The implemented consumers illustrate the migration handoff without another controller or state store:

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
or capacity. `EntityListToolbar` presents their hint/Refresh row inside the original `table-responsive` parent,
including before data arrives. Survey adopts its no-hint, end-aligned variant through its existing read-state slot.
Neither control adds a wrapper, chooses a read or changes scroll ownership.

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
Its slot preserves Survey's Refresh row between warnings and loading. The component never infers admission, replaces
a retained draft or owns a query, receipt or retry timer. Common presentation does not authorize normalizing distinct
existing timestamps or relocating a toolbar outside its scrolling/interstitial parent.

#### Backend and method-policy contracts

The [controller/DBAL rules](#controllers-and-services) apply to every transport. Central method permission definitions
live in the existing controller. Adapters can decode/coerce differently, return different envelopes or apply their
declared preconditions; capacity, ownership, deletion and access policy remain one shared business implementation.
Page membership must not silently narrow a separately granted action, and edit-token projections stay private.
Native route middleware, v1 admission and capability projection must consume the same method definition; matching
duplicated permission literals are still separate owners. Preserve operation-specific native no-op outcomes and
deadline ordering when adapting commands instead of adding an apparently helpful precondition in the v1 adapter.

Event's controller shares `eventCapacityReached` between native/v1 presentation and registration admission, including
the distinction between no limit and a stored zero. `mayReadEventChildren` shares attendance/assignment-management
eligibility between native/v1 related projections and child lifecycle rechecks. Their callers supply existing counts,
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

The existing native flash getter creates an object even for absent messages. Pilot document reads inspect existing
nonempty channels before consuming them through that library, avoiding accidental first-visit persistence. Real
feedback still uses ordinary Session/save ownership. Complete required business continuations before fallible
feedback delivery; retain their original outcome and bounded operational logging if delivery fails. Native TTL,
actual flash consumption, expiry/logout and token/provider entry effects retain their existing scoped behavior.
No general flash merger, save observer, admission transaction or global session concurrency guarantee is introduced.

Packing supplies a concrete ownership example. `packingMethodPermissions` owns requirements consumed by middleware,
v1 checks and capability projections; root property fields reuse the existing administration field policy.
`savePackingMetadata`, `addPackingItem`, `applyPackingItemPatch` and `applyPackingMembership` own the corresponding
writes/checks. Reorder/remove/default operations accept the existing service-managed transaction when an adapter
coordinates several writes. `eventController.authorizeEventLink` checks the locked destination;
`entityAdminController.applyEntityAdministrator` returns domain outcomes for each adapter's response mapping.
These are owning operations, not forwarding wrappers or business rules in DBAL. Another feature follows its own
policy/contracts rather than copying Packing's grants or persistence shapes.

`entityAdminController.entityMethodPermission` supplies common header, event-link, permission-management and
duplication requirements. Header/duplicate factories, administrator middleware and Packing's method map consume
this owner. Keep actor/profile admission and feature exceptions alongside their established consumers; a shared
grant does not imply a shared page-admission rule. Follow the definition to every actual consumer, including header
preflight/write, duplicate entry, administrators and relinking. Shared operations do not by themselves remove a
copied permission literal. Pass the owning rule into a generic factory; middleware must not import a feature's
controller merely to discover policy, and DBAL must not choose the grant.

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
owner. Failed or canceled delivery retains the same completion, including across actor remount, without replaying
a command. A navigation Retry repeats delivery only.

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
receipt through failed navigation. Do not discard other drafts because a button was hidden or capability changed.
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
through query refresh, prefetch, remount or Back/Forward. True native/external capability entry retains its admitted
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
roster. The original P1 implementation wrapped field editing and additional-profile creation in the identity
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
readiness policy. `initializePilotApp` stages initial feature mounting through `initialContentReady` inside bounded
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
renderer. It orders base `style.sass`, `help.sass` and `pilot.css` once; do not maintain another list in a caller.
Its source link and built-manifest delivery remain usable before JavaScript, including static Help. `style.sass`
retains its accordion/timezone graph and installed Bootstrap layer alongside the CDN layer.
Test emitted URLs and mounted usable controls, not a hydration marker. HMR/authored-input restart checks are relevant
when their owners change; they are not required again for every unrelated feature view.

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

Header upload passes the settings owner's `selectedFile` through the declaration contract. Confirmation releases the draft
even when follow-up fails; the editor clears the same input through the shared release owner so the same file can be
selected again. Rejection, unknown delivery and background reads retain bytes/input. Do not infer release from changed
header URL, token or translated filename, recreate the input or emit another selection event to reset it.

`feedback.ts` binds notices to semantic receipts and owns their ten-second scheduling/cancellation lifetime.
Repeated outcomes renew; locale/render changes neither renew expiry nor revive dismissed notices. Persistent
conditions use status semantics and remain visible. `App` and `AppDialog` supply common page/dialog notification
hosts through the read-only `noticeTargetKey` presentation reference. A zero-height sticky anchor and bounded
overlay preserve document layout, focus and scroll; gaps do not intercept input. Notifications never call focus or
scroll to reproduce native submission/refresh jumps. This shared rule supersedes the historical local reveal behavior.
Confirmed destinations/receipts survive failed delivery; warnings clear only through their own successful recovery.
Dispose timers/listeners and preserve page-cache restoration behavior.

`CommandFeedback` presents the existing command owner's read-only error, notice and uncertainty refs across identity,
Packing, Event, Drivers, Survey, Activity and Overview consumers. Features retain outcome wording, commands, drafts and recovery;
the shared renderer chooses notification placement. `StatusNotice` uses `placement="notification"` only for transient
receipts; durable review, validation and read failures remain contextual rather than disappearing on a timer.
Activity's registration hint and requirement-progress summary adopt that same renderer as persistent content;
the progress summary adds no live role, dismissal or expiry to its existing informational presentation.
`StatusNotice` receives an action label and optional existing action state, then emits the user's action. When state
is omitted, its `ActionButton` still applies shared initialization and the caller's handler retains its own guards.
The notice does not choose read eligibility or perform recovery. Their contracts live in
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
Use a real long page to verify sticky placement and retained viewport context after an actual command; DOM-only
focus/scroll spies cannot establish CSS containing-block behavior.

Dialogs share one focus trap/dismissal owner, pending close lock and actual invoker return. Features can supply the
body-field initial target. Tabs retain independent drafts and freeze while necessary work is pending. Avoid
simultaneous Vue/Bootstrap DOM ownership. Mixed navigation disclosures use the existing app-owned wrapper and its
established native key policy.

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
read restoring metadata/settings authority. `belongsToLocalizedQueryFamily` selects existing Help/Overview families.

Help treats the normalized article/search and fragment as its reading visit; locale-only URL changes and Refresh
do not renew anchor navigation. Router owns both deliberate anchors and saved browser history, waiting for Help's
existing admitted read or terminal error through the navigation module's mounted readiness registration. Help must
not scroll independently after a late read. While a translation temporarily hides the former-language body, the existing Help
section may retain only its last readable visit's measured minimum height so removing content cannot clamp the
reader's position. Release that presentation space on a different visit, readable replacement or terminal error;
do not copy article/request data or restore focus/scroll in response to Refresh or translation. The built Help history/Refresh/locale journey in
`tests/e2e/frontend-pilot.spec.ts` exercises actual anchors, Back, retained search input and a delayed real translated
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


<!-- /delta:amendment-01 -->

## 5. Start Surveyor — amendment-02

<!-- delta:amendment-02 -->
- Express under Nodemon through `npm run server:dev`, with Vite middleware/HMR;
- existing browser modules under `npm run server:client`; and
- serialized contract/catalog generation under `npm run server:frontend`.

Authored inputs are `contracts/api/v1/`, `src/locales/` and the exact permission registry
`src/modules/lib/permissions.ts`. The watcher observes the registry's parent so atomic editor replacement remains
visible, generates API before locales and publishes `.generated/frontend-ready.json` only after the current successful
batch. Failed or superseded batches keep watching without restarting Express with partial inputs. Other library
saves retain ordinary server restart behavior. Source serving explicitly uses `vite.config.mts` and the repository
root. Vite excludes ignored runtime evidence under `artifacts/`, alongside the existing generated/build/test-output
exclusions, so review captures and reports neither burden cold source transforms nor replace a live document.
Application source still uses normal HMR. Production runs matching built artifacts without a Vite server.

<!-- /delta:amendment-02 -->

## Project structure — amendment-03

<!-- delta:amendment-03 -->
src/frontend/                      Vue app, components, composables and feature views
contracts/api/v1/                   authored API schema and operation policy
src/locales/                        shared UI/server catalogs
src/types/                          shared .d.ts contracts
src/public/js/                     native browser modules and their helpers

<!-- /delta:amendment-03 -->

## Project structure — amendment-04

<!-- delta:amendment-04 -->
tests/frontend/                    client helpers/mounted Vue and isolated browser checks
tests/integration/                 database-backed workflows and genuine isolated server-component integration

<!-- /delta:amendment-04 -->

## Build and run commands — amendment-05

<!-- delta:amendment-05 -->
| `npm run server` | Full build, then Express/Vite HMR, existing browser watch and ordered authored-input generation. |

<!-- /delta:amendment-05 -->

## Build and run commands — amendment-06

<!-- delta:amendment-06 -->
| `npm run server:frontend` | Watch contracts, catalogs and permission declarations; publish successful generation readiness. |
| `npm run build` | Sass, database/API/catalog generation, server compile, existing browser and Vue client/SSR builds, then views/assets copy. |

<!-- /delta:amendment-06 -->

## Build and run commands — amendment-07

<!-- delta:amendment-07 -->
| `npm run build:server` | Generate shared inputs, compile server TypeScript into `dist/` and copy runtime contract artifacts. |
| `npm run build:client` | Build existing browser modules and the Vue client/SSR output. |
| `npm run build:frontend` | Check and build the separate Vue client and SSR scopes through Vite. |
| `npm run typecheck:frontend` | Check both Vue client and SSR configurations. |
| `npm run typecheck:tests` | Check the Vue-aware test import graph without executing tests. |

<!-- /delta:amendment-07 -->

## Build and run commands — amendment-08

<!-- delta:amendment-08 -->
| `npm run generate` | Rebuild database metadata and API/localization consumers without a database connection. |
| `npm run prepare:frontend` | Generate the authored API and locale boundaries only. |

<!-- /delta:amendment-08 -->

## Generated files — amendment-09

<!-- delta:amendment-09 -->
- `.generated/api/` and `.generated/frontend-ready.json`
- `src/types/api/` generated declarations and `src/types/LocalizationTypes.d.ts`
- `src/modules/localization/generated/`
- `src/public/js/**/*.gen.js`

<!-- /delta:amendment-09 -->

## Current code patterns — amendment-10

<!-- delta:amendment-10 -->
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

<!-- /delta:amendment-10 -->

## Readability and shared contracts — amendment-11

<!-- delta:amendment-11 -->
Vue templates and composables need equivalent explanations of explicit inputs, scoped data, meaningful branches,
draft/command lifetimes and DOM hooks. Document nontrivial methods with a contract and internal comments describing
their meaningful steps. Existing Pug consumers use unbuffered `//-` comments for mixin inputs and render branches;
optional feature state still uses renderer `data` and explicit arguments, never a second `res.locals` channel.

<!-- /delta:amendment-11 -->

## Routes — amendment-12

<!-- delta:amendment-12 -->
- Mount versioned feature adapters in `src/routes/api/v1.ts`; existing API consumers keep their `src/routes/api.ts`
  owner. `src/app.ts` mounts v1 before the existing HTML session-expiry redirect and view locals so structured errors
  and explicit context admission remain inside the versioned boundary.

<!-- /delta:amendment-12 -->

## Errors and responses — amendment-13

<!-- delta:amendment-13 -->
- Use the established page renderer and response adapters rather than create another response convention.

Versioned adapters use the generated request/result contracts and `ApiProblem` boundary. For new or deliberately
changed business behavior, prepare and validate a final mutation receipt before commit; a later mutable-context check
or session save must not reject an already committed operation. Scope-preserving consumers follow the
[existing-operation boundary](policies/DEVELOPMENT_POLICY.md#scope-of-separately-authorized-work) without requiring
unapproved legacy repairs. Delivery failure remains distinct from business rejection. Services never own
transport-specific errors.
Vue HTML is produced by the existing `src/modules/frontendPilotRenderer.ts` owner; existing adapters under
`src/modules/renderer.ts` retain their actual consumers. Both reuse controller projections rather than duplicate
business behavior inside templates or components.

<!-- /delta:amendment-13 -->

## Root property dialogs — amendment-14

<!-- delta:amendment-14 -->
existing feature controller and atomic persistence to its existing database service. Pass admitted field/capability
projections explicitly to shared controls. Shared contracts remain `.d.ts` declarations.

<!-- /delta:amendment-14 -->

## Root property dialogs — amendment-15

<!-- delta:amendment-15 -->
Feature draft/query/command owners coordinate each dialog's independent sections. Shared header/event/lifecycle
panels provide repeated layout and explicit events; they retain no business tokens or second file draft. Validate local
prerequisites before admitting a command. Keep selection IDs separate from discovery labels. Exports/modified clicks
leave the source draft protected, while tab changes retain independent input. Presentation-only audience/search state
does not become a business patch. Validity reporting reveals the invalid field's family before focusing it.

<!-- /delta:amendment-15 -->

## Root property dialogs — amendment-16

<!-- delta:amendment-16 -->
Event creation and association writes authorize the submitted destination with effective

<!-- /delta:amendment-16 -->

## Root property dialogs — amendment-17

<!-- delta:amendment-17 -->
invalidation is decided by the activity controller using its existing persistence/job boundaries. Shared discovery
owners provide server validation, permission-prefiltered database pages, a final engine check and opaque continuation
tokens. EventPicker receives the feature's generated discovery operation and query families: Packing injects
`searchPackingEvents` through `PackingApi.events` at `/api/v1/packing-lists/events`. The existing
`GET /api/event/link-options` adapter is a separate consumer of those business owners, not the component's transport.
The shared picker replaces result pages and retains only current/saved selection labels

<!-- /delta:amendment-17 -->

## Root property dialogs — amendment-18

<!-- delta:amendment-18 -->
Closing resolves section drafts; changing tabs preserves them. Before a departing command, resolve other dirty
sections through shared departure protection. Ordinary refresh preserves live drafts. Pending work freezes dismissal and competing commands,

<!-- /delta:amendment-18 -->

## Root property dialogs — amendment-19

<!-- delta:amendment-19 -->
is idempotent. Persist the TypeORM relation rather than its relation-ID projection; prepare required resulting
admission/capabilities before final commit. Preserve root identity, grants, files, direct archival and stored pause state.

<!-- /delta:amendment-19 -->

## Entity archival — amendment-20

<!-- delta:amendment-20 -->
owns personal overview visibility. Existing `adminApiFactory` adapters and generated v1 adapters share those
business owners. `EntityLifecycleService`

<!-- /delta:amendment-20 -->

## Entity archival — amendment-21

<!-- delta:amendment-21 -->
The existing adapter commands are explicit and retry-safe:

<!-- /delta:amendment-21 -->

## Entity archival — amendment-22

<!-- delta:amendment-22 -->
Vue controls receive feature-owned generated operations rather than calling these adapters directly. Packing injects
`archivePackingList` and `restorePackingList` through `PackingApi`; Event injects its root/child lifecycle operations;
Overview injects
`setOverviewVisibility` through its API owner. Each uses the shared transport/validated result and existing
`entityAdminController` or `userController` operation. Neither reusable lifecycle presentation nor a second
controller/service duplicates grants, root/parent policy or visibility eligibility.

`createEntityLifecycle` in `src/frontend/composables/entityLifecycle.ts` shares archive/restore confirmation,
desired-state dispatch and success wording across Settings, Overview and Event Things to do. It composes each
consumer's existing API, command and current translator without retaining state. Callers supply direct/inherited
state and any required confirmation-key override, retaining eligibility and refresh dependencies.
This includes Event/Activity scheduled-restore wording. Settings and Event child cards also adopt its pause/resume
confirmation, dispatch and result wording. Pause remains immediate; resume retains the native elapsed-schedule
warning. The caller still owns current capability checks and root/parent-scoped operations, and the same command
retains uncertain-result/read recovery. Personal visibility and permanent deletion stay separate.

Permanent deletion uses `useEntityRemoval` in that same composable module. Its three current consumers are
`EntitySettingsDialog.vue`, `OverviewRegion.vue` and `EventThingsToDo.vue`. The feature supplies its generated
root/child operation and confirmation/success wording; the shared owner obtains whole-page consent before writing,
dispatches once and retains the confirmed destination through failed delivery. Retry repeats navigation only.
Private drafts and capability checks remain with their actual feature owners.

Never accept profile IDs, timestamps, stored parent state, or other arbitrary fields from the browser. Follow the [archival authority contract](PERMISSIONS_REFERENCE.md#archival-authority-and-personal-visibility), including the survey exception. A private preference may change placement only after existing overview membership is established.

<!-- /delta:amendment-22 -->

## Entity archival — amendment-23

<!-- delta:amendment-23 -->
Render lifecycle actions through explicit authorized component projections. Personal actions remain an explicit
card contract; placement comes from the bounded overview service. Commands wait for validated confirmation before
refreshing named affected appearances. The presentation owner never infers archival dates or parent policy.

<!-- /delta:amendment-23 -->

## Paged profile overview — amendment-24

<!-- delta:amendment-24 -->
Overview adapters share controller normalization and server-owned page limits. Namespaced URL state preserves each
collection/region's filters, pages and selection. `OverviewRegion`, `OverviewItems` and `OverviewCard` divide read/navigation,
grid and card presentation without another server-data store. Read before history commitment; preserve sibling state,
modified-click hrefs, search caret and focus through failed/obsolete delivery. Retire source-owned aggregate receipts
with denied cards; unknown membership is not zero. Shared event **Things to do** retains local filtering. Database work
can grow with membership even when returned cards/DOM are bounded; measure plans and paging before adding indexes.

<!-- /delta:amendment-24 -->

## Invoice pool calculation and saved changes — amendment-25

<!-- delta:amendment-25 -->
`presentation.ts` owns signed financial presentation and the single settlement-status rule used by the interface,
emails, and PDF exports. The primary **Calculated balance** is the saved `shareAmount` after carried credits,

<!-- /delta:amendment-25 -->

## Invoice pool calculation and saved changes — amendment-26

<!-- delta:amendment-26 -->
Use the existing pure presentation/wording owners directly and pass explicit values to shared controls. Avoid a
second renderer formula or copied catalog. Programmatic hooks are independent of translated labels. Settlement actions use the same

<!-- /delta:amendment-26 -->

## Invoice pool calculation and saved changes — amendment-27

<!-- delta:amendment-27 -->
labelled, formatted steps in the interface and email; render global figures only as labels and values. Avoid a large unformatted

<!-- /delta:amendment-27 -->

## Test selection — amendment-28

<!-- delta:amendment-28 -->
npm run test:frontend:browser # isolated built-browser client behavior
npm run test:all           # Vitest + build + client browser + system E2E

<!-- /delta:amendment-28 -->

## Add or change a page workflow — amendment-29

<!-- delta:amendment-29 -->
5. Update the feature component, generated read/command contract and shared catalog together when values or actions change.

<!-- /delta:amendment-29 -->

## Add or change an API action — amendment-30

<!-- delta:amendment-30 -->
1. Author the versioned operation/schema once in `contracts/api/v1/` and regenerate its consumers.
2. Add its adapter under the existing API route owner and confirm explicit mounting.

<!-- /delta:amendment-30 -->

## Add or change an API action — amendment-31

<!-- delta:amendment-31 -->
4. Use generated validation and the shared API error chain. Prepare a mutation's validated receipt before commit for
   new or deliberately changed business behavior; unchanged shared operations retain their recorded scope under the
   [development policy](policies/DEVELOPMENT_POLICY.md#scope-of-separately-authorized-work).

<!-- /delta:amendment-31 -->

## Add a client-side module — amendment-32

<!-- delta:amendment-32 -->
1. Reuse an existing component/composable; add a feature owner under `src/frontend/` only when its responsibility is distinct.
2. Import its actual declaration/domain owner directly, with no forwarding exports or browser-unsafe dependency.
3. Use the integrated `npm run server` workflow for HMR; check client/SSR through `npm run typecheck:frontend` and build through `npm run build:frontend`.
4. Add a mounted client/helper check at the cheapest meaningful boundary; use isolated browser or system E2E only for its distinct risk.

<!-- /delta:amendment-32 -->

## Browser changes do not appear — amendment-33

<!-- delta:amendment-33 -->
Use the integrated `npm run server` workflow for Vue HMR and ordered generated inputs. Existing esbuild consumers
still use `server:client`; do not remove source or hand-edit generated modules. If an authored contract/catalog save
fails, correct it and wait for successful readiness before relying on a restart. For compiled runs, build before run.

<!-- /delta:amendment-33 -->

## Test selection — amendment-34

<!-- delta:amendment-34 -->
npm run test:quick         # configured database-free project, including scoped server integration

<!-- /delta:amendment-34 -->

## Test selection — amendment-35

<!-- delta:amendment-35 -->
The database-backed integration project rebuilds its selected MariaDB schema; the separately selected database-free
server-component fixtures use the other existing project without a schema reset. The E2E initializer drops
and recreates its selected schema. Read [Testing Guide](TESTING_GUIDE.md) before database-backed suites and never
reuse development or production database names.

<!-- /delta:amendment-35 -->

## 2. Create a development database — amendment-36

<!-- delta:amendment-36 -->
GRANT ALL PRIVILEGES ON `surveyor\_dev`.* TO 'surveyor_dev'@'127.0.0.1';

<!-- /delta:amendment-36 -->
