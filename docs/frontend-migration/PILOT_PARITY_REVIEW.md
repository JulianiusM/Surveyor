# Packing and help pilot comparison
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: current
last-verified: 2026-10-11
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: 2026-10-11 bounded migration-guideline, duplicate-risk and test/build/CI source review added; execution and reporting limits are explicit in the test-cost section; original decisions and approved amendments traced against native executable contracts and actual consumers; final coherent fa5 build, affected presentation checks, fresh HTTP/browser/configuration journeys, all 472 native/pilot originals and 15 behavioral comparisons, supplemental read-warning/scroll originals, genuine complete-package replacement/rollback in Chromium/Firefox and normal source/HMR/regeneration/restoration verified; whole quick/integration results explicitly precede only the two final presentation-template corrections; all 491 current inspected-image hashes reconciled; final source/build/native-file/type-contract checks and advisory documentation findings reviewed; prior failed or superseded checkpoints preserved; no production cutover or external-provider/email proof claimed
source-anchors: src/frontend/components/LoadingSkeleton.vue; src/frontend/styles/pilot.css; tests/frontend/frontend-loading-shell.spec.ts; tests/frontend/frontend-content-loading.spec.ts; src/frontend/composables/pageTitle.ts; tests/frontend/frontend-refresh-navigation.spec.ts; scripts/capture-frontend-rectification-readonly.cjs; docs/frontend-migration/staged/DEVELOPMENT.md; src/modules/frontendDevelopment.ts; src/frontend/app/mountPreservingDrafts.ts; tests/unit/frontend-development.spec.ts; tests/frontend/frontend-hydration-drafts.spec.ts; tests/frontend/frontend-route-recovery.spec.ts; tests/e2e/frontend-development.spec.ts; scripts/watch-frontend-inputs.mjs; scripts/capture-frontend-baseline.cjs; src/frontend/; src/routes/frontendPilot.ts; src/routes/api/v1/; src/modules/packing/api.ts; src/controller/entityAdminController.ts; src/views/modules/module_entity_header.pug; src/views/packing/packing-view.pug; contracts/api/v1/; src/locales/; docs/user-guide/de/; tests/frontend/packing-management-ui.spec.ts; tests/frontend/packing-view.spec.ts; tests/frontend/frontend-pilot-identity.spec.ts; tests/integration/packing-management-api.spec.ts; tests/e2e/frontend-pilot.spec.ts; tests/e2e/frontend-pilot-api.spec.ts; tests/e2e/frontend-identity-api.spec.ts; docs/FRONTEND_PILOT.md; vite.config.mts
next-review: pilot-UI-behavior-change-or-feature-cutover
-->

The earlier bounded implementation delegated packing operations to the native view and translated only the help
interface. It did not satisfy the requested packing replacement or localization requirements. This correction moves
packing controls into the independent Vue frontend and compares them with the corrected working Pug/browser baseline.
The [pilot guide](../FRONTEND_PILOT.md) defines ownership, commands and the remaining application-wide migration scope.

## Restored behavior and baseline

| Boundary | Current implementation |
|---|---|
| Native title | Shared responsive grid centers the entity title regardless of settings or parent-link visibility. Empty placeholders no longer move non-administrator titles. |
| Native description and counters | Multiline descriptions retain escaped line breaks and spacing before the counters. Each label/badge pair stays together; different counters can wrap on mobile. |
| Native granular item edits | Packing passes the correct title/capacity guards to the shared inline editor. Existing peer-feature defaults are preserved. |
| Packing items | Inline title/description/capacity, Everyone switch, quick add, drag ordering, item deletion and authorized removal of another assignment use the v1 API. No legacy editing/reordering link is required. |
| Settings | Details, Header image, Event, group permissions, named administrators and Actions are present when authorized. Account/guest duplication differences, owner-only deletion and direct/inherited archival remain distinct. |
| Creation and duplication | Own SPA routes preserve initial items, row controls, audience defaults, optional image/event and existing duplication copy boundaries. Historical empty titles and nullable capacities can be displayed for review; submitted creation keeps its existing requirements. |
| Overview | All five authorized entity types appear in unfiltered participation/ownership regions. Visible/hidden regions, explicit type filters, bounded search/pagination, mixed event containers and personal visibility preserve the native membership/count contract. Packing destinations and commands remain inside the pilot. |
| Identity | Login, guest entry, registration, recovery, activation/reset and logout use typed commands. **Your profiles** retains native profile management/switching; the pilot header has no added direct-profile selector. Emailed guest links authenticate on their initial GET. OIDC retains its configured protocol callback and returns to the pilot. |
| Initial document and confirmed delivery | The real browser bootstrap decoder retains typed admission, notice and completion fields. Initial document state belongs to its actor and visit. Confirmed commands retain navigation-only Retry through failed bootstrap, lazy navigation, actor remount or editor retirement; obsolete work cannot restore private controls or replay a command. |
| Help localization | All ten English and ten German articles have complete instructions, equivalent language-owned figures, recovery/privacy and advanced sections. The same locale definition selects API, native help, Vue SSR, SPA, search and TOC content. Each corpus owns its stable anchors and assets without reading another language. |
| Shared presentation | Bootstrap styling and reusable Vue controls preserve native shell/table/dialog composition. The administrator picker uses the native single searchable input, not an extra selection field. |
| Dialog layout and focus | Settings use the native small-screen fullscreen layout; event selection retains its floating margins. Event search receives initial focus and Escape restores the actual invoking control on each opening. |
| Disclosure menus | Overview and navigation reuse one native disclosure wrapper and shared placement. Ordinary Tab and embedded controls keep native behavior; outside pointer/focus dismisses without stealing focus, while Escape restores the trigger. Mobile collapsed navigation remains in document flow. This is the documented conditional primitive-fit assessment, not a primary stack amendment. |
| Stale review | Metadata Save and submit wait for explicit Review, including same-field choices. Inline conflict feedback has enough width to read within the existing mobile table scroll. |
| Native form and configuration behavior | Known server rejection clears password fields; unknown delivery and local validation retain mounted input. Pristine metadata Save reports the existing informational message without a PATCH. Disabled identity configuration uses the same full Error surface. Focus styling and pending Settings-tab behavior follow native controls. |
| Native command feedback | Operation-specific success/no-op messages retain native action availability and confirmation boundaries. Opted-in inline receipts have native Close/focus/placement and use a live fallback when the initiating host retires or hides. Full flashes retain their own presentation; locale-only changes neither renew expiry nor revive a dismissed body. Canonical creation/deletion navigation retains the native one-time notice. |
| Recovery and read authority | Unknown-outcome recovery retains pending protection through its authoritative read. Ordinary Refresh remains navigable. Late reads and accepted writes cannot clear newer command feedback, repopulate retired private caches or replace newer field authority. Creation, metadata, detail, selector and Overview read recovery shares reactive deadline-based Retry without starting a GET. |
| Generic image and Help ownership | Authorized image lifecycle accepts a feature-owned binary read and knows no Packing endpoint. Shared Help links preserve native topic/query/fragment behavior without an added Packing-return control or feature-context injection. |

## Permission and view matrix

Paired screenshots use identical fixture records, actors, permissions and local checklist state. Every scene is
captured at 1440×1000 and 390×844. Dialog screenshots use the viewport so their scrolling/focus behavior can be
reviewed. Full-page capture records and checks actual PNG/document dimensions. Mobile tables scroll internally.

| Scene family | States inspected |
|---|---|
| Packing permission views | Owner; ordinary guest; read-only; item creator without self-assignment; title-only; description-only; image/event manager; item editor; item-description editor; item deleter; assignment manager; permission manager; account duplication delegate; account administrator; guest administrator |
| Permission-filtered settings | Every granted role's initial panel, including fields/tabs that must be absent; account-only versus guest Actions |
| Full settings | Details, existing/absent header, Event and advanced filters, group permissions, named administrators, expanded administrator, administrator add form, Actions and inherited archival |
| Item states | Empty list, uploaded header, occupied/spare/full items, Everyone with existing self-membership, Packed checklist, inline text/numeric drafts and multiline descriptions |
| Linked/archive states | Authorized parent link, child-only access with denied parent link, direct and inherited archival, independent archive/restore actions |
| Creation | Blank creation, duplication, creation event picker and initial item rows |
| Identity/navigation | Anonymous guest entry, login/recovery, account/guest navigation, desktop/mobile disclosure and private return-link behavior |
| Help | Home, article, results, no matches, anonymous, German article/results, JavaScript-disabled search and fragment navigation |

There is no HTTP endpoint for creating a direct packing-item ACL. Exact child-only title/capacity grants are verified
against real stored relationships in integration tests and native DOM guards; the numeric editor is visually compared
using an owner. This does not claim that every possible persisted permission-bit combination has its own screenshot.

## Behavior and conflict checks

Built-browser journeys exercise real commands and preserve the SPA document through packing/help/create/duplicate
navigation. They cover inline stale review, numeric edits, title clearing/restoration, quick add, drag ordering,
Everyone/self-assignment exceptions, removal of another assignee, item deletion, every settings area, image upload/
removal, event relinking, archive/restore and cross-panel drafts. Saving metadata refreshes the settings token before
another command. Identity changes consult draft and pending-write guards before clearing the previous profile.

Confirmed saves remain saved when a follow-up read fails. Lost responses are not replayed. Inline/settings drafts
retain the snapshot they edited until explicit reconciliation. A session read cannot prove registration or recovery
mail completion; identity forms retain that uncertainty and allow an explicit acknowledgement before leaving.
Focus/periodic checks revalidate external identity changes. Pilot identity commands also notify other pilot tabs.

## Review boundaries and evidence

The locale selector, explicit refresh and conflict/reconciliation feedback are necessary SPA additions. They do not
replace or remove packing actions. Help article content uses a complete locale-specific Markdown corpus selected
through the centralized catalog, rather than duplicating frontend/backend strings. Default application routes remain
unchanged. Other business features and complete account/profile administration still have outward links pending their
own migration; packing operations do not depend on their frontend implementations.
Known server-rejected login/register/reset submissions clear secret inputs as the native POST-rendered forms do.
Local validation and unknown delivery retain mounted input under the shared draft protection. A pristine metadata
form retains native Save and its informational no-change outcome without sending a mutation. Keyboard focus uses
the existing native styling. Earlier records accepted these presentation/interaction differences without specific
approval; that assessment is superseded by this restoration of native observable behavior.
Known identity failures use the same operation-specific message projection as the native page, including the
existing reset-link denial. Unknown future Problems retain generic safe feedback rather than being assigned an
unverified native meaning. User-entered fixture text remains unchanged; file chooser wording follows the browser's locale.
An implicit packing-only filter previously suppressed otherwise valid membership despite nonzero indicators. That
was a defect: unfiltered overview regions now include activity, drivers, event, packing and survey records, with an
explicit type filter. Event-container administration belongs to the subsequent event slice; packing child actions
remain inside the pilot and other feature cards preserve their existing destinations.
Packing item/settings interactions retain their existing JavaScript requirement. The approved rectification adds
same-component native overview and identity adapters; their current execution evidence is recorded separately from
the preceding accepted capture below. The native navbar's unrelated contextual-Help highlighting defect is recorded once as IMP-039 in the
[remediation register](../documentation-remediation.yml); it is not reproduced in the independent router.

## Approved foundation rectification, 2026-10-08

The [approved D1–D5 ledger](../FRONTEND_FOUNDATION_DESIGN.md#authorized-rectification-2026-10-07)
governs this change. i18next-vue implements the primary translation choice. The original rectification evidence
below exercised the built runtime; it did **not** establish normal development hydration or HMR. The subsequent
development-runtime correction records that gap and its verification separately. Feature-owned API
modules, named query families and shared controls replace pilot duplication. Authored operation policies, decimal
assignment IDs and generated validation/types keep the unreleased v1 contract corrected in place.

Packing uses current-value comparisons under shared controller-owned locks, including setup fields. Sparse metadata,
item, audience and administrator changes preserve unrelated edits; header/event/order operations compare their own
state. Capacity check/write and assignment removal remain atomic. The unreleased metadata counter/migration is
removed. Unknown creation or mail outcomes require review or acknowledged departure; commands are never replayed.
Compatible loaded edits can finish after a current-folder replacement, with a single clean reload and no retained
old asset directories. Known feedback and initial identity denials translate reactively through the shared catalog.

The full frozen comparison is
[`2026-10-07T22-38-11-444Z`](../../test-results/frontend-baseline/2026-10-07T22-38-11-444Z/index.html), with its
[manifest](../../test-results/frontend-baseline/2026-10-07T22-38-11-444Z/manifest.json): all **472 originals**, all
**15 behavior checks**, zero browser errors and zero failed requests. It covers 198 native/pilot pairs and
76 German supplements at both recorded sizes. Review accounted for every original:

| Review scope | Unique originals |
|---|---:|
| Packing, creation, editors and mixed overview | 76 |
| Permissions, settings, linked/archive states and German core supplements | 220 |
| Help articles, identity and navigation | 176 |
| Total | 472 |

Reviewers inspected original pixels, including readable help crops. Exact PNG-byte or decoded-pixel comparisons
corroborated unchanged final views against the individually reviewed diagnostic images; changed images and final
representative roles were opened again. Random fixture account names and tiny native border/hover differences are
recorded separately from regressions. All 108 help images were unchanged. Independent article checks covered all
40 language/viewport pairs: equal text, image source/alt and document height, with every picture loaded.
The ignored inventories are `test-results/rectification/visual-core-inventory.json`, `visual-roles-B-review.json`
and `visual-help-identity-coverage.json`; the detailed reports retain observations and limits.

The earlier `2026-10-07T22-19-01-994Z` diagnostic is not an accepted build: it exposed header hydration and one-time
activation-feedback replay defects. Those were corrected before the successful full comparison. Built-browser
stale-review testing also exposed an undersized conditional-read header bound; valid edit tags now remain readable
after rejection. Native logout correctly admits its deliberately body-free operation.

The final localization supplement is
[`2026-10-07T22-58-26-483Z`](../../test-results/frontend-baseline/2026-10-07T22-58-26-483Z/index.html): all 32 identity
originals were inspected in 16 native/pilot pairs, with no new regression. After the final native guest-link spacing
correction, both Vue entries were rebuilt/type-checked and all 18 production smoke screenshots were opened. Real
initial CSRF and reset denials changed English to German in place without replacing the alert/document, exposing a
form or making another admission read. Other full-matrix views remain covered by the preceding frozen comparison.

| Executed check | Result |
|---|---|
| Complete application build; final frontend rebuild/type checks | Passed |
| Database-free Vitest unit/frontend layers after generated inputs were prepared by the build | 52 files / 876 tests passed; final spacing-only correction verified by rebuild and browser smoke |
| Guarded packing management, API and workflow integration runs | 17, 13 and 16 tests passed respectively; 46 across individual runs |
| Final built HTTP/browser journeys | All 19 unique cases passed: 17 in the full run and two in focused completion after stale overview test selectors/caption expectations were corrected |
| Isolated production/native/localization/replacement smoke | All eight checks passed; 18 screenshots inspected; one tracked native browser regression also passed |

Four overlapping final browser journeys were rerun to retain fresh feedback evidence under
`test-results/rectification/final-feedback-evidence/`; all four passed. All 14 desktop/mobile checkpoint originals
were opened at original resolution. Metadata review values/choices, mobile scrolling, inline stale review,
unknown-assignment versus confirmed-save refresh feedback, and cancelled/discarded drafts remain readable and
reachable. Attachment copies are byte-identical and are not counted again. The actual report attachment records
two browser `confirm` events with "Discard changes?": first dismissed, then accepted. The final review inventory
is retained under `test-results/rectification/`; browser dialog chrome is not fabricated.

The isolated release contains production dependencies only and rejects dependency fallback into the workspace.
All 20 old hashed asset paths were absent after replacement. An actual retired lazy-route request returned 404;
a clean tab reloaded exactly once. A dirty edit reloaded zero times before saving, saved once, then reloaded once.
Copy-back rollback added one reload and retained both saved rows. Evidence is
[`package-smoke/evidence.json`](../../test-results/rectification/package-smoke/evidence.json).
The final installed build identity is `975848c3d54c65b8a00df67a`, with client `entry-client-DIO5Bpx0.js` and unchanged
`entry-client-DTu8FiwB.css`; API/catalog identifiers are `c26b4208da57` / `2433a19a92d7`.

No schema initializer/reset was run during browser evidence collection. Targets remain the restricted disposable
schemas at port 33318. Owned verification servers are stopped. The advisory documentation report found no broken
links, missing npm commands or stale terms; its remaining findings concern the existing source-baseline/reference
allowance, ignored temporary reports and retained authoring-reference image. It is not a clean report or an
application gate. Canonical contribution guidance now records decision approval, controller/DBAL ownership, shared
contracts/components, native fallback, concurrency, localization, release recovery and paired verification.
Completed archival/overview/property-modal plans are retained as implemented design records, preserving their unique
rationale rather than presenting them as future work. Broader feature cutover, full accessibility certification and
a live external OIDC round trip remain outside this bounded review.

## Development-runtime correction, 2026-10-08

The maintainer's ordinary development run exposed a gap in the preceding built-runtime acceptance: the server
rendered a page, but the browser entry could not load. Vite applied its `/app/` base to an already prefixed source
URL and to Express-owned page/assets URLs. That produced `/app/app/src/...` requests, HTML error responses in place
of JavaScript and an inert server-rendered interface. The earlier URL test searched for a valid substring and then
fetched a hardcoded path; it did not verify the actual emitted script URL.

The renderer now gives Vite an unprefixed, minimal entry shell and inserts the authored Express head/body after
transformation. Vite owns `/app/`; Express retains native styles, images, help assets and navigation URLs. Middleware
restores the request URL on fallthrough. Tests fetch the exact emitted JavaScript/CSS URLs and verify status, MIME,
single-prefix behavior and untouched native paths. Production does not initialize Vite, even with the development
flag accidentally enabled.

Actual browser execution also exposed three separate startup/navigation defects. A help-language query replacement
could cancel an already pending lazy identity navigation; query synchronization now respects the pending destination.
Firefox's dynamic-import failure wording is recognized by the existing guarded release recovery. Text entered into
server-rendered controls before the entry loaded could be lost during hydration; the shared mount helper restores
dirty editable text on surviving controls through their normal input handlers. It neither replays commands nor
serializes passwords. Deferred-route and delayed-entry browser checks exercise these cases.

Generated contracts/catalogs are excluded from Vite's source watcher, and nodemon excludes the authored locale
directory. The serialized generator completion marker owns the server restart. An actual catalog edit and its
restoration each caused generation in order followed by exactly one restart. CSS and Vue-component edits, including
their restoration, applied through HMR without replacing the browser document. The ordinary `npm run server`
workflow supplied this evidence; a capture-only source server cannot establish startup/watch behavior.

Both frontend build commands explicitly select production mode. Otherwise `npm run server` can inherit development
mode during its preparatory build and compile Vue's client and server differently from a separately built release.
Replacement verification swaps the entire binary folder, including the corresponding server-renderer bundle.
Mixing development-rendered HTML with a production client is not a valid replacement test.

Final cleanup found an untracked compiler-emitted `vite.config.mjs` equivalent to the maintained TypeScript config.
Vite's default selection could prefer that sibling and later drift silently. The generated duplicate was removed;
both build commands and source initialization now bind `vite.config.mts` explicitly, with an absolute project root.
The real emitted-assets unit check initializes from an unrelated caller directory and verifies that binding. Both
unit cases and server/client/SSR type checks passed. The explicit-config frontend rebuild produced byte-identical
complete client and SSR trees, corroborated in `config-binding-build-proof.json`. This cleanup followed the frozen
full comparison and changes no view, style or component. Fresh source startup checks verify its runtime boundary.
Both development cases passed again in Chromium and Firefox after a fresh source start. One intervening Firefox
attempt failed on the external Bootstrap CDN's CORS/network response; that attempt is retained separately, and the
unchanged error assertions passed on the repeat. No application error was filtered out.

The structural follow-up keeps feature API facades keyed by the stable app/request transport and gives shared event
pickers a caller-owned typed data source. Generated wire shapes remain the source for that discovery contract;
components do not import packing-specific API/query ownership. Purposeful comments explain the hydration, pending
navigation, namespace and release boundaries in their owning modules.

The full frozen **source-development** comparison is
[`2026-10-08T04-53-13-491Z`](../../test-results/frontend-baseline/2026-10-08T04-53-13-491Z/index.html), with its
[manifest](../../test-results/frontend-baseline/2026-10-08T04-53-13-491Z/manifest.json): **472 originals**, all
**15 behavior checks** passed, and no browser errors, failed asset responses or failed requests. Source, generated
contract/catalog, renderer, native asset and help inputs stayed frozen throughout collection. The emitted client
entry was `/app/src/frontend/app/entry-client.ts`, served by the actual Express-integrated Vite runtime.

The review accounts for 76 core packing/create/editor/overview originals, 220 permission/settings/linked/archive
originals and German supplements, and 176 help/identity/navigation originals. Each scope records the actual original
paths, hashes, review method, findings and limits under `test-results/development-repair/`. All 220 role originals
were opened individually, including mobile lower-scroll controls. All 80 article originals are byte-identical to
the preceding accepted capture; readable crops of their original pixels and all 40 same-language native/pilot DOM
pairs corroborate opening sections, diagrams, tables, recovery/privacy endings, complete body text and heights.
Every image loaded. No new visual/control discrepancy was found in the reviewed matrix.

Existing accepted differences are not described as literal pixel identity. They include the language selector,
explicit Refresh, pristine Save/focus presentation, overview toolbar wrapping and feedback recovery wording. Parent
event-container global administration remains a documented subsequent slice; its omission already exists in the
accepted pilot, while packing child operations remain independent and complete. German packing/identity supplements
are checked for the same permissions, controls and localized layout against the corresponding native English fixture;
the review does not invent a German native implementation.

The completed ordinary-source browser suite passed **21 cases in Chromium and 21 in Firefox**. The two development
cases were repeated in each engine after the final build/watch correction. Each engine also passed five focused
source smoke checks with eight original screenshots. All 16 focused originals and 36 workflow-feedback originals
were inspected individually; mobile stale review, uncertain outcomes, failed follow-up reads and retained drafts
remain readable. Evidence is under `test-results/development-repair/`, with the final focused visual inventory in
`final-visual-state-review.json` and actual watcher observations in `workflow-probes/evidence.json`.

The complete database-free run covered 54 files and 889 tests: 874 passed, while 15 assertions in the existing date
helper file assumed UTC despite the parent Windows timezone. That entire file then passed all 138 tests with
`TZ=UTC`; all 889 unique tests passed across those runs. This is not a claim that the first complete run passed.
Server and both Vue entry type checks and the complete application build passed. No unrelated date behavior changed.

The supplied `file:///` warning was not reproduced: the checked emitted links/assets in both engines and the
maintained help/frontend corpus contain no such URL. It has no established cause in this review.

The final isolated production checks passed **eight cases in each engine**; all **36 final originals** were opened
and inspected. They use production dependencies only, reject workspace dependency fallback, and prove that a
production start does not load Vite even with `SURVEYOR_FRONTEND_DEV=1`. All 20 old hashed paths disappeared after
the complete-folder swap. An actual missing lazy route caused exactly one clean-tab reload; a mounted dirty edit
saved successfully before its one reload. Copy-back rollback then caused one additional reload and retained the
saved rows. Both engines reported no browser errors. The exact original release tree was restored: 808 files,
SHA-256 `06d6296bc3d88f7826bed559cf1fde2544fccc46f62bc57941808e9e93914e83`.

These production runs used build `74b214b5d3e3bf3b3fa57184`, replacement `f76bbd873e48d065c821accc` and rollback to
the original. The workspace client is `entry-client-BnIkXWaz.js`, with unchanged `entry-client-DTu8FiwB.css` and
API/catalog identifiers `c26b4208da57` / `2433a19a92d7`. Exact per-engine checks and image hashes are in
`test-results/development-repair/package-final-visual-review.json`; diagnostic attempts are excluded.

After canonical config binding, `npm run build:server` passed and regenerated the latest server. Only
`modules/frontendDevelopment.js` and its source map changed in the distribution; contracts/catalog and full
client/SSR trees stayed unchanged. Those generated helper artifacts were copied into the isolated package and all
808 files matched the current distribution. The newly compiled helper then proved the production skip with Vite
absent, the development flag enabled and workspace dependency fallback forbidden. This focused final proof is in
`config-binding-final-proof.json`; the earlier full-folder rollback fingerprint above describes that preceding run.
All owned verification servers are stopped. The maintainer's server at port 3010 was not controlled or restarted,
and no shared application database or schema was reset during this correction.

The advisory documentation report again has no broken links, missing npm commands or stale terms. Its 21 structure
findings and one help-authoring finding remain the existing source-baseline/reference allowance, ignored temporary
reports and retained authoring-reference image. The report is not clean and is not an application gate. Its generated
outputs are retained under ignored verification evidence. No user-facing help text or picture changed in this repair.

## Preceding full packing and help review

The preceding correction's frozen-build capture is
[`2026-10-07T16-49-34-114Z`](../../test-results/frontend-baseline/2026-10-07T16-49-34-114Z/index.html), with its
[manifest](../../test-results/frontend-baseline/2026-10-07T16-49-34-114Z/manifest.json). It completed all 472 captures
and all 15 behavior checks, with no browser errors or failed requests. Its source/build fingerprints remained frozen.
The client entry is `entry-client-C3j3fPvo.js`, with `entry-client-DTu8FiwB.css`; the generated API contract identifier
is `e20bab39dfda` and the shared locale catalog identifier is `fde4b1da8027`. The manifest retains the full compiled
runtime, stylesheet, Pug, help-corpus and entry hashes, plus the verified disposable database target/grant scopes.

All 472 unique originals were opened and visually inspected individually at the recorded sizes. Long articles were
also inspected through readable crops of the original pixels, including instructions, tables, recovery/privacy,
TOC and footer sections. The completed review found no unexplained visual or control gap in these captured views.

| Reviewed primary originals | Count |
|---|---:|
| Basic packing states and overview, including German supplements | 76 |
| Creation, duplication, event picker and text editors | 26 |
| Granular roles, settings, inherited Actions and Drivers/Invoice help | 210 |
| Remaining help, navigation, guest entry and identity feedback | 160 |
| Total unique primary originals | 472 |

Of these originals, 396 form 198 full native/pilot pairs and 76 are German pilot supplements paired with the same actual
English native fixture. The gallery therefore has 274 comparisons and reuses those native images; it does not
invent a German native packing frontend. Complete English and German help articles have actual native/pilot pairs.

Fourteen additional selected checkpoint screenshots were inspected for seven SPA feedback states at both sizes:

- Eight under `.temp/frontend-foundation/e2e-final7-browser/`: metadata conflict and lower choice/Review controls,
  unknown assignment outcome, and confirmed assignment followed by failed refresh.
- Two under `.temp/frontend-foundation/e2e-final7-inline-evidence/`: the entire readable inline current-value/Review/
  Cancel block, using the existing horizontal mobile table scroll.
- Four under `.temp/frontend-foundation/e2e-final7-navigation-evidence/`: cancelled navigation retaining the draft
  and accepted discard clearing it while preserving Packed. These replace the earlier four navigation images.

Attachment copies and superseded narrow inline screenshots are not counted again. The retained
[navigation report](../../.temp/frontend-foundation/navigation-evidence-report/index.html) contains the actual
`native-discard-confirmations` JSON attachment: browser type `confirm`, message "Discard changes?", first dismissed
and then accepted. Page screenshots show the resulting states; browser-owned dialog chrome is not fabricated.

That frozen implementation passed `npm run build`, both Vue entry type checks and `npm run test:quick` (837 cases in
46 files). Guarded authentication and packing-management integration checks passed 25 and 10 cases. The nine built
HTTP checks and nine browser journeys passed. Focused inline and navigation evidence recaptures each passed their
single journey; the navigation evidence config explicitly disables the schema-resetting server initializer.
API/catalog freshness checks passed for this build; `git diff --check` passed for the recorded changes.

Earlier intermediate captures are correction evidence, not approval of that frozen build. The interrupted
`2026-10-07T16-09-16-039Z` run stopped after 248 images without a manifest and is excluded. Automatic capture success
is evidence collection, not visual approval; the completed manual inspection is recorded above. Browser errors
include caught framework render errors logged through console.error, as well as pageerror. Future pilot changes
require correction, rebuild and visual/behavior review appropriate to their scope before completion. A full paired
review remains the default for feature-parity changes; an explicit maintainer request can narrow a localized fix to
focused visual smoke checks, expanding the affected module's review if those checks reveal a regression.

## Focused overview and help-figure corrections, 2026-10-07

The maintainer requested efficient, targeted verification of two defects, without repeating the full comparison
unless smoke checks revealed a regression. The current client is `entry-client-kd1OPJ06.js`, with unchanged
`entry-client-DTu8FiwB.css`; the generated API contract identifier is `31e25c16257b` and the shared locale catalog
identifier is `aca0d3bdf9d2`. The preceding capture above remains evidence for its own frozen build.

The overview now projects the existing authorized mixed membership without an implicit packing filter. Its typed
contract includes explicit selection and server-owned available types; counts, event containers, search, hidden
regions and personal visibility use the existing overview/controller owners. A selected filter survives losing
its last visible member, and type changes apply the current search draft while resetting both pagers and retaining
the event and other regions. Empty membership, hidden content and actual filter misses remain distinct.

German home, survey and packing guides now contain their own equivalent PNGs, alt descriptions, captions and
full-size links. English images retain their bytes. All translated guides own stable heading IDs and local article
links. Rendering, search and assets read only the selected corpus; missing localized content cannot borrow English
text or pictures. The reusable figure generator, final hashes and individual export inspection are recorded in
[Help Visual Assets](../HELP_VISUALS.md).

Two built-browser journeys passed against the restricted disposable schema at port 33318, using the existing built
application without a schema initializer or reset:

- Mixed unfiltered membership, survey-only filtering, hiding/restoring the last survey, clearing filters, two
  differently typed event children and filtering within the selected event, at desktop and mobile sizes.
- Each changed German figure in both native and pilot help at both sizes, loaded images and full-size links,
  same-locale article links, JavaScript-disabled fragment navigation and an unchanged English packing control.

All 21 unique viewport captures under `.temp/frontend-foundation/focused-help-overview-evidence/` were opened and
visually inspected individually: eight overview states, twelve localized-help states and one English control.
All three final release PNGs were also opened individually at full resolution; their authoring inspection includes
768px and 298px previews and the actual source-rendered German header. Cards, filters, count captions, mixed linked
children, image/caption placement and mobile wrapping showed no regression. No broad comparison was rerun.

`npm run build:server` and `npm run build:frontend` passed, including both Vue entry type checks. The focused synthetic
help suites passed 21 cases. The focused frontend/contract check passed 51 cases; the final packing-management UI
rerun passed 28 cases, overlapping that check. API/catalog freshness and whitespace checks passed. A new real
persistence regression in `packing-management-api.spec.ts` was added but the integration suite was not rerun;
the built-browser smoke exercised the corresponding mixed membership, filtering and visibility through real
controllers and persistence. The earlier full quick/integration/E2E totals above belong to the preceding review.

## User-facing content correction, 2026-10-07

The next correction removes implementation and authoring information from both user-help corpora, including existing
English text. Navigation captions and image pixels now contain only task guidance. Internal permission identifiers,
storage keys, database/cleanup mechanics, developer references and calculation/allocator implementation explanations
were replaced with plain descriptions of user actions, observable outcomes and recovery. All existing headings and
deep links, visible permission labels, feature exceptions, privacy/conflict behavior and upload/export limits remain.
The prohibition is now explicit in `AGENTS.md`, the documentation policy and the visual-authoring instructions.

Only the English and German navigation PNGs changed; both were regenerated from source markup and inspected
individually at original, 768px and 298px widths, together with their actual header crops. Final hashes are recorded
in [Help Visual Assets](../HELP_VISUALS.md). Provenance stays in maintainer documentation and ignored evidence.

Focused visual inspection caught permission labels becoming cramped after the internal-code column was removed.
The shared help-table stylesheet now gives visible reference labels readable space and keeps narrow-screen
scrolling inside the table. The corrected help module was checked across all 20 articles at desktop and mobile
sizes: successful rendering, hidden metadata, no forbidden implementation phrases, readable label widths and no
page-wide overflow. German reference-table scrolling was exercised in both native and pilot help.

The final ignored advisory browser journey passed. All 16 selected captures under
`.temp/frontend-foundation/user-help-content-evidence/` were opened individually: six navigation views, eight
permission-table views including scrolled mobile states, and two retention-guidance views. The new picture/caption
composition and corrected tables are visually accepted. `npm run build:sass`, `npm run copy:assets`, generator
syntax and whitespace checks passed. Server/Vue builds, full application suites and the broad paired comparison
were not rerun for this documentation/style correction. Its browser check reused the existing built server against
the same restricted disposable schema without initialization or schema changes.

Browser captures, manifests, logs and reports remain ignored; the new language-owned help PNGs are maintained
release assets. Checks use separate restricted users for
explicitly disposable local schemas. No shared application database is reset. This review covers Chromium and the
two recorded sizes; it does not certify other engines/devices or complete application cutover.
No live OIDC provider was configured for this run. Component checks cover the configured provider entry and
local-login-disabled presentation; a complete external-provider authentication round trip was not executed.
Mail delivery is replaced only at its outbound boundary; registration, activation and single-use recovery/reset
links run through the actual controllers, database and browser.

An identity diagnostic at `test-results/frontend-baseline/2026-10-07T14-59-22-218Z` is excluded from verification.
It accidentally selected the default local `cgd_e2e` database at port 3306. It registered and activated four
synthetic accounts with their default profiles, completed three recovery/reset workflows and wrote session state;
mail delivery was captured in memory. It ran no schema reset, deletion or business-feature fixture creation.
No subsequent cleanup or other operation against that target was performed. Capture now requires an explicit
environment file and schema acknowledgement, and rejects credentials granting access to another schema or a
wildcard schema pattern. Passing evidence uses the restricted disposable database at port 33318.

## Documentation rectification, 2026-10-08

FPR-07 preserves native production descriptions while staging the prospective frontend replacement. The native
reference is pre-pilot documentation at `2dfa257`, not proof of a site's deployed commit. README, Architecture,
Development, Testing and Database retain that native contract, together with current non-pilot source-path
corrections and an explicit link to the staged checkout instructions. Canonical Operations, Upgrading and
Configuration keep their existing procedures. Frontend-specific architecture/development/testing/database
replacements, the README and visual guide are temporary full copies under `docs/frontend-migration/staged/`;
Operations and Upgrading are narrow merge supplements. Each draft identifies its canonical target and cutover
boundary. The existing pilot guide owns the merge inventory; no new plan or control registry was introduced.

The staged development recipe now consistently covers declaration-file/generated contract ownership, controller
and pure DBAL boundaries, reuse of native permissions/admission, shared read/draft/departure/update owners,
metadata empty/null equivalence, authoritative refresh without input loss, reachable uncertain-command recovery,
scaffold TODOs, human-readable helpers/comments/spacing, JavaScript-required or read-only fallback, and focused
verification. The watcher explanation now distinguishes authored-input regeneration from Express-owned Vite HMR.
The staged architecture records generated Ajv validation and removes the abandoned persisted packing-revision
claim. The assignment-ID table is corrected to the already-authored decimal-string/null representation rather
than declaring a new wire-format choice.

The foundation and detailed framework/contract/refresh/localization records retain the original choices and
D1–D5, with explicit dated maintainer amendments for migration-only scope, current help/packing completeness,
future Overview/other increments, JavaScript fallback, active-read recovery and production documentation staging.
General authentication/session redesign, authorization-framework rework and broad legacy race/lock hardening
remain independently deferred. One task-only global localization guide and its German counterpart are staged
outside production help; they describe the actual browser-scoped preference and limited translated coverage,
without account preference, universal translation or email/PDF localization claims.

Prospective English/German localized header figures remain staged byte-for-byte with their original 2026-10-07
acceptance history. Production navigation illustrations were rendered with the existing authoring composition
and the actual canonical native Pug header, using fictional account data and no public implementation/provenance
footer. German explanatory copy retains the actual native English menu labels; native navigation does not
translate them. Only the German home image caption/description and hidden provenance were aligned with that
picture; feature task procedures were not rewritten. Each final 1440 × 1065 export, separate 768px and 298px
preview and actual 1344px header crop was opened individually. There is no clipping, collision or annotation over
a control; the narrow preview retains written procedures and a full-size link. Final hashes are recorded in the
canonical visual guide. The localized future caption remains staged. Authoring adaptations and fingerprints stay
in ignored `.temp/frontend-docs-rectification/` evidence; no new illustration subsystem or committed runtime
helper is required.

The existing optional help report now discovers fixed corpus routing from authored locale catalogs. It reports
20 articles, 390 links and six embedded images across the English and German corpora, with independent per-corpus
references and no cross-language fallback. The three added synthetic tooling cases protect discovery, missing
local articles/assets and invalid corpus routing. `node --test scripts/tests/documentation-check.test.mjs` passed
33 cases; these fixtures do not read maintained prose. No CI, lifecycle, application-test or release gate was added.
Exact optional-path occurrence allowances were updated for the expressly required staged copies; the explanatory
reasons identify their removal at cutover. Historical source fingerprints were not rewritten.

`npm run docs:check -- --output-dir test-results/frontend-pilot-rectification/documentation-final` completed as
an advisory report with zero broken links, missing npm scripts or missing documented paths. Its remaining
20 structural findings are the historical source-fingerprint mismatch and 19 ignored local report files without
maintained-document metadata. The separate help finding is the intentionally retained controls illustration,
whose refresh remains in the existing backlog. These findings are retained; an advisory exit zero is not a clean
report. Completed archival, Overview and entity-properties design histories and prior pilot decision/review
records remain because they contain unique behavioral and ownership evidence.

This documentation/tooling increment started no application or database, performed no schema reset and claims
no new runtime parity, browser, deployment, migration or authentication-provider evidence. The prior default-local
`cgd_e2e` diagnostic at port 3306 remains excluded exactly as recorded above; valid earlier browser evidence used
the restricted explicitly disposable schema at port 33318. This entry neither changes nor extends that evidence.

## Frontend runtime rectification, 2026-10-08

FPR-01–06 implement the known findings under the migration-only boundary in the
[pilot implementation record](../FRONTEND_PILOT.md#previous-rectification-implementation-2026-10-08). Existing business
behavior, controller/DBAL responsibilities, native grants and D1–D5 remain the baseline. No authentication system,
general permission framework, schema change or repository-wide lock protocol was introduced. The independent
`BACKEND-HARDENING-01` backlog retains that work; Overview and other future increments retain source TODOs.

Metadata drafts now use one empty/null comparison rule and retain their original baseline separately from current
authority. Unknown PATCH recovery remains reachable even when values have been reverted or the current token is
unchanged. Explicit Review releases uncertainty without replay; the settings dialog owns one departure decision.
A rejected 412 uses the internal authoritative read while the command is still pending, whereas public Refresh
remains blocked during an actual command. A confirmed save followed by a failed settings read remains saved.
Identity/guest forms use complete dirty predicates and the shared command/departure/update owner. Selected-event
display follows current authority independently of the draft ID; eligible recovery is bounded at 60 seconds, while
healthy refresh, visibility and server cooldown rules remain. Overview search preserves native debounce, input
focus, other regions and navigation/history semantics.

Packing HTML uses native resource loading and page admission before rendering, including missing-resource 404s,
standalone guest entry and attached event/view alternatives. Duplicate GET retains its native `DATA_DUPLICATE`
grant independently of account-only creation POST. Its existing public form context is returned with the copy for
initial and SPA navigation, avoiding an unrelated account-only read. Root/item field declarations serve both
capabilities and submitted-field checks through their existing owners. Interactive pages have a localized
JavaScript-required message outside the hidden hydration root; help and admission errors remain readable.

The built browser check exposed a title-effect loop introduced by the admission wrapper: both it and the packing
feature subscribed to the shared title they wrote. The existing `usePageTitle` helper now derives the document
title from its local formatted value, and an undefined wrapper title leaves ownership with the feature. A real
PackingEntry component regression checks browser title and locale transitions. Individual image inspection then
found a bare admission notice instead of the native Error card/Home action, and review wording claiming a list
change after an unchanged-authority read. Packing admission branches now reuse the existing `PageMessage`;
unknown review describes uncertainty independently of actual changes. The staged implementation recipe records
these ownership/presentation rules and requires hydrated behavior rather than treating successful SSR as proof.

| Executed check | Result and boundary |
|---|---|
| `npx cross-env TZ=UTC npm run test:quick` | Final source passed 919 cases in 55 files. The focused 46 cases overlap this total. |
| Final `npm run build` | Passed Sass, generated contracts/catalogs, server TypeScript, both Vue entry type checks, client/SSR compilation and asset/view copies. Existing Sass/Bootstrap deprecation warnings remain. |
| Focused packing/fallback components | Final presentation correction passed 46 cases, including title/locale ownership, query-free admission cards and unknown-response recovery. |
| Guarded `packing-management-api.spec.ts` | 17 cases passed through real persistence, transactions and controllers. The exercised controller/DBAL behavior was unchanged afterward. |
| `frontend-development.spec.ts` | Two source-browser checks passed: source assets, lazy navigation/locales and early overview input retention. These preceded the title/presentation corrections and do not certify source PackingEntry execution. |
| `frontend-pilot-api.spec.ts`; `frontend-pilot.spec.ts` | Final built run passed all 19 cases: nine HTTP/admission/API checks and ten browser journeys. |
| `node --test scripts/tests/documentation-check.test.mjs` | 33 synthetic tooling cases passed; maintained prose is not an application-test dependency. |

The final API identifier is `a2d67f9e5665` (45 operations, 71 schemas); the locale identifier is `a25f5659d7dd`
(two locales, 422 messages). Final built journeys exercise native-equivalent admission and error-card/Home markup,
CSRF/context/privacy, stale edits, unknown outcomes, mobile assignment, item edits/reordering, settings,
creation/duplication, personal overview navigation and help. Evidence is under
`.temp/frontend-foundation/fpr-corrections-final-evidence/`; the guarded runtime log is
`.temp/frontend-foundation/fpr-parity-server-corrections.log`. The preceding 19-case result at
`fpr-built-stable-evidence` preceded the final presentation correction and remains separate historical evidence.

All 32 originals under `test-results/frontend-rectification-readonly/2026-10-08T09-27-36-677Z/` were opened
individually: eight English/German native/pilot help scenes and 24 packing, settings, recovery, disabled-JavaScript
and missing-resource scenes. Normal packing/settings layout matched native apart from established pilot controls;
help layout/images matched within each language pair. Message-only fallback and readable help showed no clipping
or page-wide overflow. The four affected pilot 404/review-top originals are superseded by the correction set.

All 12 originals under `test-results/frontend-rectification-readonly/2026-10-08T09-41-55-975Z/` were then opened
individually at 1440 × 1000 and 390 × 844. Native/pilot 404s share the Error card, icon and Home action while retaining
404 and pilot localization. Unchanged-authority review no longer claims another edit. Scrolled Review controls fit
above the fixed footer; clicking Review removes uncertainty, retains the unsent draft and enables Save. Both
complete manifests report zero application/asset errors and horizontal overflow. Each run's two failed requests
are exactly its two deliberately intercepted PATCHes. The correction run records two real GET 304 recovery reads
and exactly one intercepted PATCH per journey, with no replay after Review. The earlier capture also proves two
hydrated packing Refresh interactions returning GET 304.

The tracked optional capture helper blocks browser mutations before dispatch. Its only session-establishment
exception is one native login of an existing fictional account; credentials/cookies remain in memory. It creates
no business fixtures, changes no schema and controls no server. Recovery images demonstrate simulated response
loss against real unchanged read authority, not a backend write; component cases cover before/after-write loss,
and the real browser journeys cover lost assignment responses and confirmed-save/read-failure behavior. Partial
unbounded/font-phase attempts are excluded rather than counted as successful capture evidence.

Database checks explicitly selected MariaDB at `127.0.0.1:33318` and proved credentials had only USAGE and grants
on their exact escaped schema before execution. Integration used disposable `surveyor_frontend_test` through
`node .temp/frontend-foundation/run-guarded-integration.cjs tests/integration/packing-management-api.spec.ts`;
the integration runner rebuilt that selected disposable schema as designed. Built HTTP/browser/capture checks
selected `surveyor_frontend_e2e` via `.temp/frontend-foundation/e2e.env` and the existing-server
`fpr-admission.config.ts`, with one worker and no initializer/reset. Normal controller fixture writes remain part
of the HTTP/browser tests. Source checks used `surveyor_rectification_e2e` through the config-binding development
starter, also without an initializer/reset; their output is `.temp/frontend-foundation/fpr-development-final-evidence/`.
No operation in this increment selected the default port-3306 target. The earlier excluded diagnostic remains
recorded above and does not become passing evidence.

An interrupted source attempt restarted during concurrent generation/build and is excluded. Earlier built attempts
with an interrupted runtime, test-fixture/locator corrections or the diagnosed title loop are likewise excluded;
only `fpr-corrections-final-evidence` is the final 19-case result. Owned source/built application process trees were
stopped after testing/capture; ports 3106/3189 are closed and the pre-existing isolated MariaDB remains untouched.
Source startup/HMR and deployment-replacement evidence from earlier increments remains historical. No full
472-image comparison, other browser engine, live OIDC provider round trip, application-wide cutover or deployment
was rerun or performed for this correction. The documented native/scaffold/backlog boundaries remain in force.

The final optional `docs:check` report at
`test-results/frontend-pilot-rectification/documentation-completion/` found zero broken links, missing npm scripts
or missing documented paths. Its 53 structural findings are the retained historical source-fingerprint mismatch
and 52 ignored local report/error-context Markdown files without maintained-document metadata. The separate help
finding remains the intentionally retained controls illustration. These advisory findings were not hidden,
rebaselined or turned into delivery gates; exit zero does not mean a clean report.

## Progressive loading implementation, 2026-10-08

The maintainer explicitly requested skeleton loading and independent, incremental delivery for slow pages. The
[dated delivery amendment](../FRONTEND_FOUNDATION_DESIGN.md#authorized-progressive-delivery-amendment-2026-10-08)
preserves the original decisions and D1–D5. This increment changes frontend delivery and presentation; existing
domain rules, authentication, permission declarations, controller/DBAL owners and the iteration scope remain.

The shared `LoadingSkeleton.vue` supplies short-line, field, table, card and article shapes, one localized status
per loading region, responsive layout and reduced-motion CSS. Its decorative shapes carry no fabricated records,
counts, actions or field authority. Initial status remains outside busy state; loaded projections report their
background reads as busy. Confirmed empty results and terminal errors end initial placeholders.

Interactive Overview HTML now returns the authoritative session and Vue shell without sequentially reading all
four regions. Each open region uses its existing scoped API/controller and renders independently; an open hidden
deep link need not wait for main counts. Read-only help retains complete SSR. Packing, creation/duplication,
metadata, guest entry, identity admission, help navigation and event discovery use the shared loading owner.
Packing settings schedules its metadata read alongside full settings when the known list capability permits,
with permissions and tokens still supplied by each endpoint. Available content appears immediately; subsequent
reads retain the mounted form and its draft. Same-resource locale failures retain known packing content with
existing stale feedback, while confirmed denial or a different resource removes that projection. Lazy route
delivery displays progress over the current view, and destination focus waits for an actual navigation commit.

| Executed check | Result and boundary |
|---|---|
| `npm run build` | Passed server compilation, both Vue type checks, client/SSR builds and asset/view copies. Existing Sass/Bootstrap deprecation warnings remain. |
| `npx cross-env TZ=UTC npm run test:quick` | Logic and component source passed 955 cases in 57 files, including the final initial/background busy assertions. The later decorative card-layout correction changes no query, command or draft logic. |
| Shared loading/shell/hydration focus | 30 cases passed: five shared variants, valid parsed SSR markup, one status, delayed/cancelled/redirected/superseded lazy navigation and existing shell/hydration behavior. These overlap the quick total. |
| Feature loading focus | Packing passed 48 cases; identity and selected-event/navigation passed 37; Help/Overview passed eight before the final busy assertions. The final quick run covers those assertions. These overlap the quick total. |
| Final shared/component focus | After the card utility refinement, shared skeleton/navigation and Help/Overview passed all 26 focused cases. The same scenarios are included in the quick total above. |
| Built `frontend-pilot-api.spec.ts`; `frontend-pilot.spec.ts` | All 21 cases passed: nine HTTP/admission/API checks and 12 browser journeys, including the two new held-read checks. This precedes the decorative card-layout correction. |
| Initial loading-only browser capture | Both held-read cases passed with ten desktop/mobile original screenshots. Real media emulation confirmed stopped skeleton animation for reduced motion. |
| Final `npm run build:frontend` | Passed both Vue type checks and matching client/SSR compilation after replacing duplicated card-layout CSS with existing Bootstrap utilities. |
| Final loading-only browser capture | Both held-read cases passed again on the final build; all ten final desktop/mobile originals were individually inspected. |

Built evidence is under `.temp/frontend-foundation/fpr-loading-built-evidence/`; initial loading captures are under
`.temp/frontend-foundation/fpr-loading-visual-evidence/`. Both Playwright run records report passed with no failed
tests. Capture uses the existing optional `E2E_PILOT_STATE_SCREENSHOTS=true` checkpoints and the bounded grep
`loading (overview regions|packing and settings)`. The initial anchored grep selected no tests and is excluded
from passing evidence. Network gates delay real API delivery only; fixtures, payloads, session admission and
controller workflows remain real. No synthetic backend projection replaces the built workflows.

All ten initial originals were opened individually at 1440 × 1000 and 390 × 844. The owner Overview region is
already usable while the participant region remains skeletal. The missing packing table has visible muted shapes,
and its completed title/counters/table/form return to the prior baseline. Settings metadata and a focused entered
title are usable while the remaining settings skeleton is visible. Completed settings remove the skeleton and
preserve that same focused draft, with native desktop/mobile dialog proportions and reachable Close/Save controls.
The browser assertions verify draft value and focus after both actual responses complete. Inspection found the
shared card skeleton used three desktop columns while real cards use four. Shared card shapes now reuse the
existing Bootstrap row/column utilities and gutters, avoiding duplicated breakpoint/spacing rules and feature
overrides.

After that decorative correction, `npm run build:frontend` passed and the two loading journeys passed again under
the same guarded setup. All ten originals under `.temp/frontend-foundation/fpr-loading-final-visual-evidence/`
were opened individually and supersede the preliminary set. Desktop skeleton card widths now match the ready
sibling cards at approximately 316 pixels within the 1440-pixel viewport, with the same native gutters. Mobile
cards form one contained column. The pending participation region remains skeletal while the real owner card,
actions and counts are usable. Packing and settings retain the confirmed loaded layout, focused title draft,
reachable controls and ordinary mobile table scroll, with no remaining placeholder or page-wide overflow.
The final run record reports passed with no failed tests. This is a bounded Chromium desktop/mobile inspection;
intermediate tablet geometry and a live screen-reader session were not separately inspected. Reduced motion is
covered by actual browser media emulation, rather than inferred from still screenshots.

The guarded built runtime selected `127.0.0.1:33318/surveyor_frontend_e2e` through the existing isolated environment
and config. Startup verified credentials restricted to that exact schema before application construction. It
ran no initializer, schema reset or process-level retention jobs. Normal HTTP fixture writes remain part of
these tests. The owned built server and its child were stopped afterward; ports 3189/3106 are closed and the
pre-existing isolated MariaDB remains running. No default-port-3306 operation occurred in this increment.

API/catalog identifiers remain `a2d67f9e5665` and `a25f5659d7dd`; no contract, locale, schema or DBAL change was
needed for loading. This increment did not rerun database integration, the full 472-image comparison, source
startup/HMR, deployment replacement, another browser engine or a live provider round trip. Prior evidence remains
historical. Production user/operator/developer documentation is unchanged by this loading increment; reusable
loading and test guidance is staged until cutover. The existing native/scaffold/backlog boundaries still apply.

## Native parity and shared ownership rectification, 2026-10-08

The maintainer authorized implementation and explicitly amended unauthorized duplication to return after login
to the exact `<entity>/<id>/duplicate` URL, including query context. The
[design amendment](../FRONTEND_FOUNDATION_DESIGN.md#authorized-parity-and-shared-ownership-amendment-2026-10-08)
preserves the original native ordinary-create return and the later approval. The
[implementation record](../FRONTEND_PILOT.md#native-parity-rectification-2026-10-08) records current ownership;
the [staged development recipe](staged/DEVELOPMENT.md#implementing-the-next-feature-slice) is the maintained
contribution guidance. The native remediation backlog has no changes from this increment.

Shared server admission delegates to existing user/entity controllers and Packing business operations. Native
creation uses generated structural validation plus named transport-only scalar converters; error ordering follows
the generated schema rather than another field list. Existing event authorization still runs before native
decoding. Database services, entities, migrations, archival, hard deletion and file retention are unchanged.
Every existing guest-flow factory consumer uses the same renderer action and exact duplicate-return rule,
including the deliberate survey exception. Document expiry retains provider logout evidence; API expiry remains
structured. Guest registration reaches canonical detail, invalid guest links retain native denial, and confirmed
recovery uses the native message destination whose subsequent GET still redirects to login.

Shared page-entry navigation retires stale and pending-destination responses, preserves mounted editors while a
redirect is being guarded, and removes controls after confirmed denial. One-time notices keep their server-owned
severity. A confirmed identity receipt survives an unavailable session read only for its matching actor; Retry
resumes the captured destination once without replaying the command. Full completion messages use actor-scoped
memory receipts. Locale ordering has an independent generation. Nested draft owners register one global guard
tree; confirmed settings values remain distinct from authoritative write tokens when a follow-up read fails.

| Executed check | Result and boundary |
|---|---|
| `npx --no-install cross-env TZ=UTC npm run test:quick` | Passed 1,013 cases in 60 files after the final admission, identity, recovery and draft logic corrections. The later shared presentation correction changes only markup/style and has separate focused checks below. |
| `npm run build` | Passed all normal build stages. The normal `npm run server` workflow subsequently completed its own full build before starting the source app and watchers. Existing dependency/Sass deprecation warnings remain. |
| Guarded Packing integration selection | `packing-api.spec.ts`, `packing-management-api.spec.ts` and `packing-workflows.spec.ts` passed all 46 cases against real persistence. Later corrections affect presentation, native validation error ordering and command receipt handling, without changing the exercised persistence operations. |
| Four built HTTP/browser files | `core-workflows.spec.ts`, `frontend-identity-api.spec.ts`, `frontend-pilot-api.spec.ts` and `frontend-pilot.spec.ts` passed 44 of 46 cases. The other two assertions omitted the approved locale query in document redirects; correcting only those assertions and rerunning the two cases passed 2 of 2 on the same runtime. This verifies 46 distinct cases, not a single all-passing 46-case run. |
| Normal source `frontend-development.spec.ts` | Passed all three cases through `npm run server`: source modules/lazy navigation and locale refresh, input typed before Overview hydration, and a real Packing item POST plus authoritative refresh without replacing the document. |
| Final `npm run build:frontend` | Passed both Vue type checks and matching client/SSR builds after the shared visual correction. |
| Final shared shell focus | `frontend-pilot-shell.spec.ts` passed all 11 cases, including native compiled Pug versus Vue SSR/mounted label and footer text, and the actual production message-layout stylesheet. Ordinary-page spacing and visible notices are preserved. Eight cases overlap the quick total; the three presentation cases were added afterward. |
| Final built entry/recovery capture | The two affected browser journeys passed again on the corrected presentation build, producing the final eight desktop/mobile originals inspected below. |
| Synthetic documentation tooling | `node --test scripts/tests/documentation-check.test.mjs scripts/tests/documentation-advisory.test.mjs` passed 45 cases. Reports remain advisory and maintained prose is not an application-test dependency. |

Built browser fixtures cover native creation for all five modules, shared exact duplicate return, server admission,
expired identity, invalid guest links, canonical guest completion, recovery, settings and command recovery,
progressive loading, Overview and Help. The initial broader diagnostic failures and cold SSR timeout are excluded
from passing evidence; they led to the corrected reset fallback, bounded unique fixtures, correct selectors and
the final checks above. Empty test selections are also excluded. No test weakened observable assertions to claim
an unexecuted workflow. The multi-locale cold SSR check has a documented compilation budget rather than a sleep.

Individual inspection of the entry/recovery originals exposed an extra icon-to-label text gap, footer whitespace
and a four-pixel message-page offset. `FormField` now lets the native icon margin own the gap. `AppFooter` retains
native icon adjacency and nonbreaking separators. Shared `PageMessage`,
the application shell and its stylesheet preserve native message spacing without a feature-specific override.
Ordinary-page alert spacing and visible notices remain intact. These findings required the final frontend build
and focused browser recapture; the preliminary pictures are not final parity evidence.

The final eight originals under `.temp/frontend-foundation/current-shared-presentation-final-evidence/` were opened
individually, captured with 1440 × 1000 and 390 × 844 viewports. Mobile guest forms use full-page 390 × 1183
pictures; recovery fits 390 × 844. Guest forms share the native title, notices, fields, action order,
desktop geometry and narrow-screen wrapping. Recovery shares the native Success card, message, Home action and
card geometry. The approved locale selector remains present in the pilot header. Captures wait for fonts and
check horizontal overflow; they show the real controller-backed workflows rather than synthetic page data.
An independent Chromium canvas read compared all four final native/pilot image pairs below the 56-pixel header:
each pair had zero differing pixels, including its footer. This is evidence for these captured states and sizes,
not a claim about every role or viewport.

Integration selected only `127.0.0.1:33318/surveyor_frontend_test`; its guarded runner rebuilt that dedicated
disposable schema. Browser/source checks selected only `127.0.0.1:33318/surveyor_frontend_e2e`. Helpers verified
the selected database and schema-limited grants before use. Built startup and browser runs performed no initializer
or schema reset; fixtures performed ordinary HTTP writes. Normal source startup ran its existing invoice-retention
boundary against that disposable schema, with automatic archival disabled. Only owned application process trees
were stopped afterward; the pre-existing isolated MariaDB was retained. No default-port-3306 operation occurred.

API/catalog identifiers are `52664d8af503` and `81b77141b8f5`. The current increment does not claim a new full
472-image comparison, production cutover, deployment replacement, another browser engine, live provider round
trip or external mail delivery. Prior evidence remains historical. Six tracked generated reports and the required
documentation CI invocation were removed; temporary evidence is excluded from maintained-document discovery and
source fingerprints. Optional documentation reporting retains the existing baseline-fingerprint finding and the
already recorded unused illustration finding; historical baselines and that illustration were not rewritten.
The final advisory report inspected 78 maintained Markdown files with no broken links, metadata errors, missing
scripts, missing documented paths or stale terms. Its two findings remain visible in the ignored review output.

## Source and documentation reconciliation, 2026-10-09

The maintainer authorized the remaining parity corrections and reconciliation of existing migration guidance.
This increment retains the primary design, D1–D5, native module boundaries and the explicit amendments already
recorded above. It adds no migration backlog, documentation file, required documentation gate, schema change or
new framework. The current summary describes the corrected implementation; earlier dated execution records,
counts, fingerprints and capture sets remain historical evidence for their own source snapshots.

The repeated corrections exposed gaps in the review method as well as defects in the implementation. Some tests
used the new API or a manually constructed frontend context as their own oracle, bypassing native behavior or
the actual emitted-bootstrap/browser-decoder boundary. Success and sequential cases missed held reads,
unmounted forms, newer authority, actor transitions and confirmed commands whose destination failed to load.
Shared protections were adopted inconsistently by adjacent consumers. Later corrections also introduced drift,
while the migration recipe continued describing older ownership. Passing those narrower checks did not establish
the full original contract.

The corrected existing owners now cover those boundaries:

- Initial document admission, feedback and completion pass through the shared bootstrap codec and belong to the
  current actor and document visit. Ordinary departures retire consumed state; fragment navigation remains in
  the same document. Confirmed identity and business commands retain their destination through failed delivery,
  with navigation-only Retry and a shell fallback after the owning editor retires.
- Whole-page draft consent precedes irreversible deletion. Pending and unknown command status can outlive a
  retired form without retaining unauthorized controls or private query data. Recovery protects its matching
  actor/document/mounted lifetime; desired-state reconciliation adds this protection only for an unknown outcome.
  An older ordinary read cannot acknowledge a newer uncertain command or replace its feedback.
- Metadata publication checks the current field and read authority separately from command settlement. Late
  accepted writes and conflict reads do not recreate retired caches. Known command errors preserve the native
  operation-specific wording; future Problems retain the generic fallback. Local registration feedback keeps
  the native exclamation mark, while the controller's remote rejection keeps its period.
- Help uses one browser-safe navigation-policy owner. Contextual event selection is admitted by the existing
  controller, remains optional, and is emitted only when the corresponding query requests it; ordinary responses
  retain their earlier shape. Native navigation disclosures share one interaction/placement owner under the
  original conditional primitive-fit decision. Overview reads its requested region before committing navigation,
  preserves other regions' newer query state and normalizes only authoritative clamped results.

The [existing contribution recipe](staged/DEVELOPMENT.md#baseline-to-observable-verification) now requires an
independent native observable oracle, explicit actor/resource/document/locale/unmount ordering, actual startup
decoding, known-versus-unknown command outcomes and failed destination delivery. It distinguishes ordinary refresh
from protected unknown-outcome recovery and records approved choices separately from primitive-fit assessments.
Help visual generation has an explicit staged-output option; these corrections did not regenerate or overwrite
release-shipped illustrations. Maintained prose remains advisory rather than an application-test or CI dependency.

| Final executed check | Result and boundary |
|---|---|
| `npm run build` | Passed server, browser and SSR type checks, client/SSR builds and asset/view copies. |
| `npm run test:quick` with `TZ=UTC` | Passed all **1,176 cases in 60 files**, 291.36 seconds, on the frozen source with no concurrent Playwright or artifact writer. |
| Guarded Packing management integration | `packing-management-api.spec.ts` passed **22 of 22**, 60.90 seconds, against the verified dedicated disposable schema and real persistence. |
| Built HTTP, `backend-parity-playwright` configuration | Passed **23 of 23**, 59.4 seconds, including independent native/pilot admission and identity feedback assertions. |
| Built browser, `backend-browser` configuration | The final clean run passed **17 of 17**, 1.1 minutes, after the bounded selector correction described below. Native/pilot label, focus and geometry assertions passed. |
| Retained browser pictures | Four final originals were opened individually: packing owner desktop, owner dialog desktop, guest mobile and guest Actions mobile. Controls, dialog/footer and the existing mobile table scroll remained readable and usable. |

The final runtime has build identifier `82e4fb92eae68bc435f63289`, client entry
`assets/entry-client-hkhfpXia.js`, API identifier `9e49b37b539d` and catalog identifier `a5205db5a13d`.
The compatibility family remains `v1-pilot-2026-10-07`; no revision-retention protocol was added. The HTTP and
browser results above use this same build. Integration and both E2E runners verified `127.0.0.1:33318` and
credentials restricted to their selected disposable schema. Built HTTP/browser startup ran no initializer;
ordinary fixture writes used the existing HTTP workflows. The integration runner used its existing disposable
schema procedure. No production or default-port database operation is claimed. The final port check found no
listener on 3189; the pre-existing isolated database was retained.

Correction-stage failures are retained as diagnostic evidence, not counted as passing final executions:

- Held identity-recovery checks initially failed **three cases**, with **one passing**; they demonstrated that
  recovery needed the same retained status and lifetime fencing as the adjacent command consumers.
- Cross-review rejected unconditional `selectedEvent` response emission because an older strict mounted client
  could reject it within the unchanged compatibility family. The final optional, query-triggered projection keeps
  no-query responses unchanged. Cross-review also caught conflation of the two native registration punctuation
  variants; the final operation-specific messages preserve each literal independently.
- An earlier full quick run without UTC passed 1,147 cases and failed 17: fifteen runner timezone assumptions,
  one mid-edit cooldown state and one affected hydration fixture missing return data. The final UTC run above
  supersedes that diagnostic; the earlier run was not a passing suite.
- The first built-browser run passed sixteen cases and failed one label selector. A native font glyph preceded
  the accessible Survey label, while the screenshot showed correct focus. The helper now matches the visible
  label suffix without changing application behavior; the isolated case then passed, followed by the clean
  seventeen-case run above.

Repository inspection also found an untracked compiled `frontendIdentity.js` duplicate created during this
increment. It was removed through its verified literal path; its creation mechanism is unknown. No native
remediation backlog, DBAL service, entity, migration, package, CI, user-guide or tracked generated-output change
was introduced by this reconciliation. The authorized pure Help navigation source remains part of the correction.

This increment did **not** rerun the full 472-image role/state comparison, normal development startup/HMR,
deployment replacement or another browser engine. It performed no production cutover, live OIDC-provider round
trip or external SMTP/mail-delivery verification. The four inspected pictures and current paired assertions are
bounded visual evidence, not a replacement for the historical full matrix. The original design and approval
records, completed plans with unique contractual evidence, native production guidance and staged prospective
documents remain intentionally retained; cutover reconciliation is still separate work.

## Native observable parity rectification, 2026-10-09

The next independent review found remaining differences that the preceding accepted comparisons had not resolved.
Known server rejection retained masked passwords, pristine metadata Save was disabled, and custom focus styling
had been treated as acceptable without specific approval. Configuration-denied identity pages, same-document
fragments, denied Overview cache restoration and pending Settings controls also needed correction. The existing
owners now restore native behavior; no additional observable exception or primary technology change is approved.

Source review and independent native comparisons then exposed adjacent gaps: reactive read Retry was not adopted
by every affected resource consumer; image/cache lifecycle and Help navigation still contained Packing policy;
generic Saved messages and invented punctuation differed from native operation outcomes; inline notices lacked
native Close/focus/placement; translation and target relocation could renew an old receipt. Later review caught
missing alert attribute forwarding, concurrent-region delivery ownership and an audience selector that remained
enabled during pending modal work. These corrections stay within the existing shared or feature owners. Explicit
Retry availability is shared by creation, metadata, detail, selector and Overview reads; identity/session transport
still enforces deadlines without claiming those buttons use the same reactive availability helper.

Repeated corrections failed to close the original contract because the evidence was too narrow. Tests using two
consumers of the same new API did not establish native behavior. Helper-level checks did not prove adoption by
every consumer. Success-only and sequential journeys missed inactive deadlines, hash changes, revoked caches,
retired editors and hidden feedback hosts. Immediate screenshots missed dismissal and reactive renewal. Later
corrections also introduced integration gaps, while the contribution recipe and current acceptance prose lagged
the implementation. Restoring the native oracle required comparing its actual routes, rendered controls, collectors,
messages and keyboard behavior, including disabled controls rather than decorative `tabindex` alone.

The [existing development recipe](staged/DEVELOPMENT.md#baseline-to-observable-verification) now covers these failure
modes: independent native observables, per-consumer shared-owner adoption, actor/resource/document/locale/unmount
ordering, known versus unknown outcomes, pre-write consent and navigation-only delivery Retry. It also distinguishes
ordinary flashes from opted-in inline feedback, requires native no-op/validation availability and operation wording,
and tests expiry after translation or host retirement. Shared image reads and cache-family selection remain
caller-owned. Original decisions, D1–D5, approved amendments and earlier execution records are preserved.

The next independent review first passed the existing 150-case regression collection in three files, then failed
two added actual-consumer diagnostics. Packing's English private cache reappeared after a German 400 admission
denial when the English return read was held. A rejected Header logout (`CSRF_INVALID`, 403) renewed its notice when
language changed at nine seconds; the body remained after 10.001 seconds. These failures exposed missed consumer
adoption and cached admission authority despite the earlier passing helper and component coverage.

The shared entry owner now retires prior render authority and locale/route snapshots while preserving the producing
typed denial. Initial seeds consult live document eligibility; a fresh scoped read is required for restoration.
Packing's callback retires related private projections, preserves independent public guest admission and copied
drafts, and retires inactive duplicate-source caches after 404. Header logout uses its command receipt for renewal.
The native adapters retain established metadata diagnostics/omissions and capacity error data while strict v1
validation and typed Problems remain unchanged; malformed item omissions retain their distinct native outcome.
Schema-derived native metadata maximum checks preserve Joi/HTML UTF-16 counting, including supplementary characters;
ordinary v1 metadata bounds retain standard code-point counting. Native creation acquires no additional text limits.
The existing Testing Guide now permits bounded temporary-output tooling tests, and Framework verification separates
native-reference checks from the approved migrated fallback contract. No primary choice or new exception changed.

Correction-stage verification then passed 236 of 238 cases in five files; two held-item checks exposed an empty
observed query recreated during synchronous cache eviction. The corrected retirement order passed the subsequent
143-case, two-file check. The first full build reported two `TS2345` diagnostics in the new native error-body
contract; the body type was aligned before the coherent passing build below. Neither diagnostic execution is
counted as a passing final check.

A further independent review reproduced four failures in actual prehydration creation controls and one successful-read
authority regression. Non-text drafts and file state were lost at the real mount boundary; helper coverage had only
protected text. A newer metadata 200 response narrowed editable fields, but returning to an older cached language
with its read held restored earlier grants. Explicit field-constraint comparison also found an invented 1000-character
password maximum, and actual invalid-login HTML returned pilot 401 instead of native 500; the approved v1 401 remains
a separate transport contract. These are defects to rectify, not newly approved observable exceptions.
The preceding 1,268-case passing collection did not exercise those complete startup-control, partial-200 authority,
accepted-credential and HTML-versus-wire boundaries. The existing recipe now requires those comparisons and separates
generic cache mechanics from feature admission policy.

Further accepted-input review found an eight-unit native password that standard code-point `minLength: 8` rejected.
The existing generator now supports an explicitly authored UTF-16 minimum on the four registration/reset properties,
preserving the original subset preference and explaining its bounded adjustment in the API design. Native existing-item
capacity also accepts zero, negative, null and raw decimal drafts; the generic positive-number editor/patch policy
had narrowed it. A guarded native SQL oracle established the configured database's rounding, signed-range and
invalid-value outcomes. The finite scalar `anyOf` carries the original draft through the existing locked operation
without another converter or copied limits. Creation/new-item policy stays separate. Native-unbounded creation,
quick-add and inline title/description controls acquire no added HTML length limit, while metadata keeps its actual
native bounds. No additional observable exception or primary stack change is approved.

The preceding completed snapshot used deployment `c49d9c969de6e7462d460c16`, client
`assets/entry-client-CAi66sjC.js` and catalog `ab107c6326c8`. Its isolated quick run passed 1,246 cases in 60 files,
314.71 seconds, starting at 08:11:36 UTC; rebuilt-SSR HTTP passed 23 with one conditional skip in 1.1 minutes.
Browser passed eighteen cases in 1.5 minutes, with disabled/provider-enabled configuration cases passing in
16.6/13.8 seconds. Those earlier executions did not close the findings above. Their retained pictures and runtime
identifiers remain historical; the table below records the corrected source separately.

| Preceding executed check, before the further review | Result and boundary |
|---|---|
| `npm run build` | Passed the coherent server/browser/SSR build and type checks after the latest admission, Header receipt and native validation/error corrections. |
| Isolated `npm run test:quick`, `TZ=UTC` | Passed **1,268 of 1,268 cases in all 60 files**, 318.94 seconds; started at 10:12:41 UTC. Owned browser/artifact writers and documentation writes were stopped during the run. |
| Guarded Packing management integration | Passed **22 of 22**, 64.30 seconds, starting at 10:19:25 UTC. The existing real-transaction case now checks captured reparenting and exact native/v1 409 wording. |
| Built HTTP | **23 passed, one conditional skip**, 1.0 minute, against the rebuilt current SSR. Independent native/v1 assertions cover metadata diagnostics, supplementary-character length interpretation, omitted root/item outcomes, capacity 409 wording/data and identity/guest admission. The separately executed variants below cover the configuration-dependent boundary. |
| Built browser | Passed **18 of 18**, 1.3 minutes, against the current deployment fingerprint below. |
| Disabled local-login/OIDC configuration variant | **One of one passed**, 14.9 seconds. |
| Local-login-disabled/provider-enabled configuration variant | **One of one passed**, 13.1 seconds; this checks configured application admission, not an external provider round trip. |
| Preceding visual inspection | The twelve follow-up originals, six desktop and six mobile, were opened individually by independent reviewers at their recorded earlier snapshot. Native/pilot 404 geometry and Metadata Review/acknowledgement were inspected there; no new capture set is claimed for the latest source corrections. |

That preceding deployment identifier is `40b0cf829e24113c98c77975`, with client entry
`assets/entry-client-C7OZGtN_.js`, stylesheet `assets/entry-client-OxDIC55R.css`, API identifier `9e49b37b539d`
and catalog identifier `957ef4a24e8b` containing 460 messages in two locales. Those HTTP, browser and both
configuration executions passed against that build. The API compatibility family remains `v1-pilot-2026-10-07`.

The eight pending-control originals and thirty-two earlier read-only originals were also individually inspected.
The earlier read-only inspection exposed English admission drift: native `packing not found` and the native
event-registration message had different wording or punctuation. Those sources were corrected before the final
build; the twelve fresh follow-ups supersede the affected older pictures. These 52 inspected originals are evidence
for their respective snapshots, not a claim that all were captured from the final runtime or that the full 472-image
matrix was repeated.

Diagnostic failures remain distinct from the final passing executions. Earlier browser runs passed 15 of 18 and
then 16 of 18; review corrected obsolete focus expectations and timing assumptions, while actual native comparisons
also revealed the mobile modal-header gap and admission wording defects. An isolated two-case browser check passed
before that preceding clean eighteen-case run. An earlier whole quick execution passed 1,245 of 1,246 and timed out in
one cold development SSR startup case at its existing 30-second budget. Concurrent watched-workspace browser HTML
trace writes correlated with Vite reloads; they are not established as the sole cause. No assertion or timeout was
weakened. An isolated full run started at 07:54:58 UTC passed 1,246 cases in 316.69 seconds before the source-input
guard expanded beyond the frontend directory. The latest isolated run above passed again after the owned writers
stopped. The preceding HTTP run passed 23 cases with one conditional skip in 1.2 minutes, then its source-clean
rerun passed the same count in 1.1 minutes. The table separates current execution after the latest admission and
native transport corrections. Earlier passing executions do not substitute for that verification.

Two unexpected adjacent copies, `src/frontend/composables/feedback.js` and
`src/modules/localization/generated/permissions.js`, were retained outside source under ignored `.temp` while
their provenance remains unproven. The later inventory found the permission copy with a 06:59:09 UTC timestamp;
independent in-memory imports compared both permission maps and found all 28 entries identical, so no permission
behavior drift was demonstrated. Extensionless imports can select an adjacent copy before maintained TypeScript
despite passing type checks. The existing generation suite now checks this collision across all of `src/`, including
shared helpers and generated TypeScript registries. At that preceding snapshot, the post-quarantine build passed;
the client artifact fingerprint remained `c49d9c969de6e7462d460c16` with the same entry and stylesheet. SSR was rebuilt and type-checked; no earlier SSR
binary hash was retained, so byte identity is not claimed. The isolated whole quick-suite execution passed with the
all-`src/` guard, and the HTTP rerun passed against that rebuilt SSR. Current execution above covers the subsequent
source corrections separately.
Neither artifact explains away the independently demonstrated native behavior and ownership defects.
Nonfatal local connection warnings appear in current and earlier quick logs; no blanket absence of warnings is claimed.

The latest integration runner verified `127.0.0.1:33318`, the dedicated disposable `surveyor_frontend_test` schema,
and credentials limited to `USAGE` plus that schema's grants before its existing test reset. The separate E2E schema
and initial default schema were not reset. Earlier integration results remain attached to their recorded snapshots.
Built HTTP/browser and configuration startup used no persistence initializer or reset.
That preceding follow-up did not rerun the full role/state matrix, normal development startup/HMR, deployment replacement
or another browser engine, and it verified no external SMTP delivery, live OIDC-provider round trip or production
cutover. Only existing documentation files were reconciled; no new documentation file, backlog entry or
documentation CI/application-test gate was introduced.

### Final correction verification (2026-10-09 checkpoint)

The following execution superseded the preceding table for its recorded source. Earlier results and images remain
evidence for their own snapshots. Passing helper checks had missed actual consumers, complete startup control kinds,
successful partial-authority changes, accepted native input domains and HTML-versus-wire status. The contribution
recipe now requires an independent native oracle and observable assertions at those affected boundaries; it does
not infer parity from two consumers of the same new API or from an earlier binary.

| Current executed check | Result and boundary |
|---|---|
| `npm run build` | Passed strict server/browser/SSR type checks, both Vue bundles and packaged runtime artifacts. The subsequent normal development build retained the recorded runtime-directory fingerprints. |
| Isolated `npm run test:quick`, `TZ=UTC` | **1,287 of 1,287 cases in all 60 files**, 315.21 seconds; started at 13:31:50 UTC. Owned browser, artifact, source and documentation writers were stopped. |
| Guarded Packing management integration | **22 of 22**, 69.33 seconds, starting at 12:43:06 UTC; verified the restricted disposable test schema before its existing reset. |
| Built HTTP | **28 passed, one conditional configuration skip**, 1.3 minutes; includes seventeen native/v1 existing-capacity comparisons, credential/Unicode/HTML-status and accepted native-input checks. |
| Built browser | **22 of 22**, 1.6 minutes, against deployment `9974402a51e2c9313108ac0d`. |
| Disabled local-login/OIDC variant | **One of one**, 14.7 seconds. |
| Local-login-disabled/provider-enabled variant | **One of one**, 13.0 seconds; configured first application hop only. |
| Normal source development | Normal `npm run server` and **three of three** source-browser cases, 12.1 seconds; real CSS application/restoration retained the document, and authored-input generation completed before normal server restart. Original CSS bytes/locale modification time were restored and owned processes stopped. |
| Current visual inspection | **50 originals, 25 desktop and 25 mobile**, individually opened by three reviewers; paired pristine/admission/guest/recovery and affected pending/draft/conflict states, plus bounded unpaired readability checks. No additional confirmed visual defect; no full 472-case matrix rerun. |

The current deployment is `9974402a51e2c9313108ac0d`, client entry `assets/entry-client-CiX-q7kM.js`, stylesheet
`assets/entry-client-OxDIC55R.css`, API identifier `440ce1250886` (47 operations and 78 schemas) and catalog identifier
`a43cb929f7c0` (460 messages in two locales). API compatibility remains `v1-pilot-2026-10-07`. Fingerprints across ten
recorded runtime/content directories are byte-identical before and after the built HTTP/browser, configuration and
normal source-development executions. All 534 frozen source/configuration/test hashes still matched after the final
isolated quick run. Older 52-picture and full-matrix records do not identify this runtime's current capture set.

The first current whole quick invocation omitted the required `TZ=UTC`: 1,263 passed and fifteen failed of 1,278;
all fifteen were unchanged date expectations under inherited Europe/Berlin time. The unchanged UTC rerun passed
1,278 of 1,278 in 340.23 seconds before subsequent capacity corrections. A later 1,287-case pass in 326.62 seconds
preceded the final Vite artifact-watch correction; the isolated table above covers that correction too. Assertions
and timeouts were not weakened.

The initial current browser run passed twenty of twenty-two. One fixture opened the editor before the preceding
quick-add refresh settled; it now waits for existing observable completion. The comparative native flash also
disappeared in native-only automatic-redirect probes. The controlled native oracle uses an independent cookie, a
completed 302 body and exact asserted `Location`/`next` before the final GET; notice and geometry assertions remain.
This inherited native session/redirect timing defect remains unchanged and outside the pilot rectification.

Source-development diagnostics first used a retired header selector, then proved a real second document request
caused by Vite observing Playwright trace HTML under `.temp`. The readiness oracle now uses the actual
hydration-complete marker and asserts a retained document. Vite ignores evidence/build directories while preserving
normal source HMR and authored-input regeneration. A rapid reverse CSS save fell inside the installed 50-millisecond
watcher throttle; separate completed saves verified actual application and restoration without an application HMR
change. The final normal-source proof passed; earlier failed runs remain diagnostic evidence.

Current logs and fingerprints are retained under ignored `.temp/frontend-foundation/` as
`third-rectification-final-isolated-quick.log`, `third-rectification-final-build.log`,
`third-rectification-final-integration.log`, `third-rectification-final-http.log`,
`third-rectification-final-browser-clean.log`, `third-rectification-final-auth-disabled.log`,
`third-rectification-final-auth-provider.log`, `third-rectification-development-validated.log` and
`third-rectification-final-fingerprint.json`. The fresh originals are in
`backend-rectification-browser/`. Review evidence is neither a committed artifact nor a release requirement.

Integration reset only the guarded `surveyor_frontend_test` schema. Built HTTP/browser, configuration and normal
source startup used the separate restricted E2E schema without an initializer or reset. This correction did not
rerun the full 472-image role/state matrix, deployment replacement, another browser engine, external SMTP delivery,
a live OIDC-provider round trip or production cutover. Nonfatal localhost connection and npm configuration warnings
remain recorded. Only existing documentation was reconciled; no native backlog entry, new documentation file,
documentation CI gate or application assertion against maintained prose was introduced.

The independent final source review found no additional confirmed ownership, authorization or formatting violation
in the affected boundaries. All 21 files under `src/types/` are declaration files, and `git diff --check` passed.
A read-only advisory documentation audit checked 26 maintained migration/baseline/design/pilot documents, 1,014
local file/heading links and 653 source anchors with zero findings. That reference audit adds no application
coverage or delivery gate and wrote no reports or extra files.

## Full review and rectification (2026-10-11)

The maintainer requested a complete review against the original approved vision, decisions, behavior and edge-case
baselines, then explicitly authorized rectification within the existing migration boundary. The earlier completed
checkpoints did not establish acceptance of the source reviewed on this date. This increment preserves the original
decisions and their recorded amendments; it does not approve a new UI difference, operation store, persisted revision,
domain policy or unrelated native refactoring.

### Findings and their correction owners

| Demonstrated gap | Correction within the existing owner |
|---|---|
| An HTTP rejection status could be treated as a known command failure without a trustworthy Problem. HTML, malformed bodies, mismatched HTTP/body statuses and server failures therefore could release uncertainty or clear secrets. | The shared transport admits confirmed rejection only from a validated known Problem or safe detail envelope with matching status below 500. Other outcomes retain unknown delivery. A structurally valid future rejection retains safe detail and native secret clearing, while only known validated codes authorize machine-state transitions. Features select native wording after that boundary rather than interpreting arbitrary status or payload fields. |
| Binary image failure handling did not consistently use the shared transport's authority, cancellation and server-deadline rules. A cancelled response could install a cooldown for a newer read of the same resource. | The binary transport uses the same validated rejection owner and checks captured actor/epoch and cancellation before decoding an error or accepting Retry-After; its image consumer also owns resource/version authority. Applicable localized JSON reads retain their captured-locale policy. A locale-only change does not retire healthy same-version image bytes. The existing authorized-image owner respects the common read cooldown/policy and a bounded missing-image retry timer; it recovers a missing same-version image after a successful ordinary or manual JSON read, including equal JSON, while retaining a healthy blob. Optional image failures remain silent and add no visible Retry control. |
| Metadata maintained a second command lifecycle, and confirmed submitted values could be confused with fresh read authority. A pre-command read could supply an obsolete token or grants, while an unchanged read could incorrectly settle an unknown operation. | The existing shared command owner now owns metadata too. Confirmation acknowledges submitted values while retaining their baseline, grants and token until a causally later authoritative GET. The operation cancels an older GET and owns its fresh read. Failed post-save reads preserve saved/blocked state, and unchanged unknown recovery still requires deliberate Review. Both Settings read deadlines remain visible to their respective controls. |
| Read consumers still treated a raw 401/403/404 as authoritative after the write classifier was corrected. An unvalidated HTML or malformed read could retire the mounted metadata/settings editor and its local draft. Conversely, the warm admission owner handled typed denials but could retain the child after a genuine validated HTTP denial. | One `isReadDenial` predicate in the existing transport owner requires validated confirmed rejection before applying the terminal read-status policy. Packing, Overview, selectors and the shared admission barrier consume it. An unusable read preserves its existing projection and draft for read recovery; a genuine validated denial retires the admitted subtree and feature-selected private authority, preserving independent guest admission and observed copied drafts. |
| Temporary-read warnings omitted the original design's last successful refresh information; metadata could also hide its background-read warning while a draft existed. | The existing shared StatusNotice accepts the query owner's last-successful update time and uses the existing translator's shared formatter. Features supply it only for a readable projection in the current scope and show their existing warning/Refresh while retaining a metadata draft. No separate timestamp state, feature formatter or normal healthy-view label is introduced. |
| The original read policy was not traced through every current owner. A disabled cooldown control did not display retry timing; Help, cold resource admission, guest-title and ordinary session failures lacked applicable manual recovery. Generic read warnings also discarded validated input/future details, and initial query retries used deterministic delay. | The existing shared notice/read-recovery owners present the authoritative Retry deadline and safe validated explanation. Existing feature, selector, entry and session owners retain their successful-read receipts and expose read-only recovery; genuine typed denial retains its native presentation. The context's retry policy provides bounded jitter. Token checking remains a deliberate read, and no token-consuming action or command is polled or replayed. Optional-image failures retain the native silent presentation. |
| The shared notice accessed the context's fixed translator directly. Locale changes worked, but its cached label/read-time/issue computations did not observe the selected Vue binding's same-language resource updates. | A notice within the pilot uses the existing `usePilot` binding; the no-context standalone path retains its fixed fallback. The real-application resource-update regression includes the actual notice alongside the retained draft. No parallel resource-event adapter or plugin substitution is introduced. |
| Native toolbar, disclosure semantics, modal focus and literal form-label comparisons exposed differences that earlier bounded pictures had missed. | Overview reuses the existing disclosure owner and native Filter actions, including independent linked-entity visibility. Shared disclosure triggers retain the native button role. Dialogs retain the native initial focus policy; the form label and Settings spacing follow their native executable owners. No cosmetic or accessibility deviation is inferred from migration authorization. |
| Browser verification omitted two existing user-observable branches. | The maintained built-browser suite now exercises existing-email Cancel/Continue as new guest and rejected MIME/oversize header uploads preserving the accepted image and authoritative version. Real session, persistence and binary reads remain in the journey; outbound email delivery alone is replaced. |
| A dead Packing DBAL lookup and repeatedly reconstructed ordering membership added avoidable maintenance cost. | The unused service lookup is removed, and one named current-item membership set belongs to the existing locked Packing business operation. Authorization and validation remain controller-owned inside the service-managed transaction; no new controller or service is introduced. |

The original persisted metadata revision was implemented in the initial spike. Its later removal is the explicitly
approved D2 amendment, rather than an unauthorized omission discovered here. D4 already selected reconciliation
without an operation store: preserving uncertainty after an unchanged read restores that contract. The previously
recorded primary i18next-vue and normal development/HMR departures remain historical deviations with their original
decisions and restoration evidence intact; a later design edit is not retrospective authorization.

### Why earlier corrections did not close the review

The retained commits, tests and review records support concrete coverage failures, rather than a conclusion about
the authors' motives. Several corrections fixed their demonstrated cases, but the review then treated that bounded
evidence as sufficient for a wider acceptance claim. New API/helper results were sometimes compared with another new
consumer of the same source, leaving the native route, collector, form, focus or feedback contract untested. Successful
and sequential journeys did not expose held responses, retired consumers, partially reduced authority, unchanged
recovery reads or a cancellation arriving before binary error decoding. A helper passing also did not show that every
actual consumer adopted its lifecycle and Retry rules.

The checked-in Overview expectations themselves required select controls, the singular `1 matching entity` and an
added **Clear filters** action, so passing them reinforced the implemented difference instead of the native oracle.
Earlier safe-Problem and wrong-status cases ended at GET or the transport rather than a submitting consumer. One
deferred initial-data case had already made its read obsolete; it did not exercise acceptance of a successful empty
initial collection. The corrected checks use the actual native controls and labels, submitting consumers, ordinary
Refresh, completed generation and live progressive initial reads, including local drafts during toolbar arrival.

A follow-up native comparison also found that normalizing a submitted search did not cover an initially bookmarked
query containing raw spaces: only the navigation-delivery path adopted the returned canonical query. The ordinary
admitted-read path needs the same bounded adoption, without erasing an in-progress local search draft or disturbing
another region's parameters. The `056b127f6e99bba5a7ec962f` build and its HTTP execution therefore remain a candidate
checkpoint. Final acceptance evidence must come from the coherent source after that correction; the interrupted
quick execution and candidate capture are not final passes.

The next coherent candidate, `3d3c357e59476aff9fa9b3da`, passed its HTTP boundary but the full browser run passed
23 of 24: the Filter role assertion could not find a button even though the visible disclosure was present. The
first diagnostic explanation incorrectly classified that as a selector assumption after inspecting only the
pilot's emitted summary and accessibility tree. Independent native-source inspection showed explicit button roles
on navigation triggers and actual buttons on Overview Filter/card triggers. The pilot's missing shared button role
was therefore an implementation difference. The native role assertion is retained, the shared owner is corrected,
and this browser failure remains evidence for that superseded candidate. Visual similarity alone did not protect
the accessible interaction contract.

The same candidate's whole UTC quick run passed 1,338 of 1,341. Its three failures retained the old select-based SSR
contract, a former four-input expectation after the native toolbar change, and a loading-stage focus expectation
after the empty region had actually been confirmed. These diagnostics require assertions against the native control
contract and distinct pending versus confirmed-empty state, rather than restoring obsolete UI or weakening native
role checks. Dialog opening focus likewise follows the native container, with the event picker's explicit body-field
exception; it is separate from inline-feedback Close focus and committed region-navigation focus.

A further source and causal consumer review found the terminal-read gap above after the shared write classifier was
already corrected. The write boundary's passing malformed-response tests did not protect consumers that classified
GET failures directly by status. A red reproduction mounted the actual Packing page, dialog, Settings and metadata
fields, then returned HTML 403 from their read. The assertion that the local editor remained mounted expected true
and received false; the focused run failed that case with 26 unrelated cases skipped. This demonstrates the actual
discard path rather than inferring it from a transport helper. The `bcf6e5bf496184153b690b0a` candidate passed 28 HTTP
cases with one conditional skip,
but its quick execution was stopped and its private package copy was not executed after that finding. It does not
establish final acceptance. This is another concrete example of the missed integration boundary, rather than a reason
to change the approved error/uncertainty contract or accept an unexplained difference.

The ordinary-read policy test also explicitly expected `refreshInterval(new ApiFailure(403, null))` to return false.
With no validated envelope, that expectation encoded the same raw-status terminal policy and missed automatic
convergence after an unusable client response. The corrected control still checks genuine validated denial, while
actual mounted-observer cases exercise recovery after malformed 400/403. Validation precedes terminal client-error
classification; 429 and server Retry-After retain their existing separate deadline behavior and no command is replayed.

Admission required the same trace in the other direction. Its ordinary endpoint represents denial as a typed 200
response, but the approved read-denial policy also covers validated HTTP denial. Handling only the typed form left a
warm admitted child mounted after a safe 403/404; removing only its refresh receipt did not remove private authority.
The existing barrier now retires that subtree and its old producing payload before awaiting cancellation, and invokes
the feature's existing dependency policy. Cache hits and captured SSR seeds cannot restore it; a fresh admitted read
must do so. This does not change the independent guest-admission or already-copied duplicate-draft exceptions.

Creation-context denial distinguishes protected server projections from permitted local recovery data. An already
initialized form retains its entered fields and original file-input node, but its fieldset and named command handlers
remain disabled without admitted form context. Server-owned event titles/pickers, audience definitions and presets
are removed. A fresh actual GET can restore those capabilities around the same local input; a cold denied context
mounts no form. This follows the original read-denial and permitted-recovery policy, rather than approving another
UI difference. No FileList transfer helper or second file store is introduced.

The denied-authority barrier must remain separate from its latest recovery-read result. Pinning the original denial
as the displayed error could hide a subsequent 429/503 and its Retry deadline even though private data remained
correctly blocked. The existing admission and Overview owners therefore present their current scoped read failure
without restoring denied projections; only a fresh admitted success releases the authority barrier.

A subsequent focused union started at 08:35:20 UTC and passed 496 of 499 in 186.68 seconds. One diagnostic fixture
omitted the Problem contract's required `requestId`; explicit generated validation identified that invalid fixture,
while the selected-binding correction remained necessary. Two Packing assertions compared Vue public-instance
proxies despite the same component uid; their corrected identity checks use the retained real DOM/input boundary.
That diagnostic is retained rather than reported as a pass or used to change application behavior. The barrier's
latest-error/deadline regressions require the subsequent coherent source too.

The bounded follow-up passed all 212 cases in three files in 101.76 seconds, starting at 08:41:46 UTC. It exercises
the real selected-binding notice, admitted-entry receipt/draft/denial recovery and Overview's denied 503/429 cooldown
and successful restoration. This focused pass does not replace the coherent full-build and runtime acceptance work.

The last-successful-refresh requirement is explicit in the original approved `2dfa257`
[temporary-read policy](REFRESH_CONFLICT_DESIGN.md#errors-and-cancellation), and remained unchanged in the spike and
correction commits. The 2026-10-08 clarification changed the failed-read delay; it did not defer this display. The
later native-parity amendment permits explicitly approved SPA differences, including this original temporary-read
state. This rectification therefore implements the original requirement in the existing failure warning instead of
silently rewriting it as future work. No new design amendment or timestamp-specific maintainer approval is claimed.
Healthy views retain their native presentation; the query's admitted successful-read time remains the single source
of truth, and a different actor or unavailable protected projection supplies no stale timestamp.

The follow-up traced every original current-read clause to the actual view and owner, rather than checking that the
new helper and its tests agreed. The original policy also explicitly requires visible Retry timing and manual
recovery for recoverable reads; a correct cooldown timer or disabled button does not provide that information.
Static Help's nonpolling policy did not exempt it from manual recovery. Cold resource admission, the independent
guest title and an ordinary session failure likewise need their own read-only recovery instead of relying on an
unrelated uncertain command, focus event or document reload. The reset-token check already had deliberate Retry,
but its boolean failure state lost the server deadline and explanation. Creation/duplicate recovery already had
a guarded action; its retained read warning needed the applicable receipt and deadline too.

Validated input rejection must explain the query/validation issue, and the original localization design requires
a future error's safe text detail. Generic stale/load-failed wording alone did neither. A current observer test
even returned a validated future 400 while asserting only the generic stale text and stopped polling. This proved
the schedule but missed the message. Likewise, at most two initial retries existed, but their deterministic delay
did not fulfill the original jittered-backoff requirement. The approved one-minute convergence amendment changed
the later failure-cycle bound, not these presentation, recovery or jitter obligations. These gaps explain another
bounded review failure: implementation presence and timer tests were treated as realization of the complete
approved read policy. The correction preserves that policy and reuses its existing owners; it does not silently
defer the requirements or introduce an unrelated future-feature migration.

The selected library's resource-event subscription also exposed a missed D1 consumer boundary. The existing
real-application translation test changed a resource and observed a fixture using `usePilot`; it did not cover the
notice's direct fixed-translator access. That path supported locale changes but its cached computed messages did
not depend on same-language resource additions/removals. Inspecting the installed binding's subscription and
translation proxy established the causal difference. The actual SSR/hydrated-application regression then failed:
its ordinary fixture's **Save** text updated after `addResource`, while the notice retained its old last-successful
refresh wording. That red run passed two cases and failed this one in 52.37 seconds. The existing binding is reused
by contextual notices, with
the standalone no-context fallback preserved; tests must install the actual plugin for contextual fixtures rather
than making a second translation adapter pass in isolation.

Earlier retained visual matrices belonged to older binaries. Later bounded follow-ups did not revisit the complete
role/state surface, so native Filter, modal-focus and exact-label differences remained observable despite later green
tests. Capturing a picture and checking its dimensions establish neither a visual inspection nor authorization for
a difference. This review keeps each image set and test run attached to its source snapshot and requires individual
inspection of the actual final originals before reporting visual acceptance.

The `3d2ba62a6b457a2f086b8953` candidate completed its coherent build, all 1,407 quick cases in 60 files and all
373 integration cases in 22 files. Its full browser journey first passed 23 of 24 because the fixture clicked the
Filter disclosure while the preceding empty-search change was still awaiting the native 300-millisecond debounce.
The committed collector then replaced the disclosure and focused its heading during the next click. Native source
and the actual request trace established this sequencing cause. The bounded fixture correction waits for the
committed canonical URL and the region's completed read before keeping the same exact Filter/All types actions,
roles and assertions; the rerun passed all 24. This is distinct from the earlier genuine missing button-role defect.
An ignored read-warning journey also first assumed **Retry** instead of the actual **Try again** label. Correcting
only that harness assumption produced four passing read-only recovery journeys and eight separately inspected
desktop/mobile warning originals. Both diagnostic runs remain retained; neither changed application behavior.

That candidate's fresh full matrix completed all 472 normal native/pilot captures and its behavioral comparisons.
Individual review then demonstrated an eight-pixel greeting gap and a twelve-pixel collection gap in Overview:
the pilot's extra greeting wrapper and collection margin differed from the native executable composition. These
were not approved differences. They required restoration in the existing template owners and another coherent
build, full runtime replay and complete fresh matrix, now completed below. The candidate matrix remains diagnostic
evidence rather than final visual acceptance. Passing functional journeys and a completed capture do not override
a measured native-layout difference, and the earlier broad review's claimed parity did not cover this exact
composition. At that checkpoint, package replacement and normal development verification were still pending for
the corrected binary. The completed current evidence follows below.

The existing [contribution recipe](staged/DEVELOPMENT.md#implementing-the-next-feature-slice) now connects each changed
journey to its independent native executable oracle, actual consumer and observable assertion. It records differences
and explicit approval in this review owner, preserves command confirmation separately from read causality, exercises
retired-response and image-deadline integration, and routes test selection through the existing Testing Guide. This
is a correction to the maintained guideline; no additional plan, report registry or required documentation gate is
introduced.

### Completed current verification (2026-10-11)

The initial pilot reviewed on this date did not satisfy the approved contract. The corrections above restore its
original requirements and native executable behavior within Help/Packing, their necessary foundation and identity
journeys, and the implemented Overview scaffold. Independent source review found no further demonstrated
unauthorized difference or ownership violation in those boundaries. The original choices and approved amendments
remain recorded; this completion neither authorizes a new departure nor claims the remaining application-wide
migration or production cutover is complete.

The final coherent build is `fa5dc669f33da4c75bb81ddd`, with client `entry-client-D3C8kVeb.js`, API source prefix
`440ce1250886` and catalog prefix `505538834507`. The full quick and integration executions belong to the preceding
coherent source. Exactly two existing Vue presentation templates changed afterward to restore native greeting and
collection spacing, and the table-scroll ownership of the Packing edit hint. Their affected frontend checks, the
full build and every runtime/visual check below were then repeated against the final binary. The server, native
browser code, contracts, catalog and the other eight runtime
directory hashes remained unchanged; this is bounded combined evidence, not a claim that the full quick suite ran
again against the later binary.

| Executed boundary | Actual result and scope |
|---|---|
| Whole database-free quick suite, before the two presentation corrections | **1,407/1,407**, 60 files, 564.21 seconds, starting 08:46:01 UTC. Earlier interrupted or failing executions remain diagnostic. |
| Whole guarded integration suite, before the same presentation corrections | **373/373**, 22 files, 455.55 seconds, starting 08:46:16 UTC, against the separate restricted disposable test schema. No shared/default database was reset. |
| Affected final frontend checks | **209/209**, two files, 103.13 seconds, starting 09:25:24 UTC. Actual Overview/Packing presentation and native executable assertions passed. |
| Final coherent release build | **Passed**, including server, frontend and SSR type/build checks. The final rebuild after development restoration also exited zero and reproduced the same deployment/API/catalog and all ten runtime directory hashes. |
| Built HTTP | **28 passed, one configuration-dependent skip**. Real route, middleware, session and database boundaries remained in use. |
| Built browser | **24/24**. Includes existing-email Cancel/Continue as new guest and rejected MIME/oversize header uploads retaining the accepted header/version. |
| Authentication configurations | **1/1 local-login-disabled** and **1/1 application-owned provider first hop**. No external-provider round trip is claimed. |
| Current temporary-read warnings | **4/4** real mounted read-only recovery journeys, with eight desktop/mobile originals individually inspected. Includes retained metadata draft after unusable 403, Help safe 400 explanation, and applicable 429/503 UTC receipts/deadlines. |
| Native/pilot mobile table scroll | **1/1**. Actual scroll geometry and hint clipping match; Shift+Tab reaches the in-container Refresh and Enter completes a real conditional GET 304 with no writes after fixture setup. Three originals individually inspected. |
| Complete final native/pilot matrix | **472 originals and 15/15 behavioral comparisons**, completed 09:53:36.238 UTC in `test-results/frontend-baseline/2026-10-11T09-36-41-526Z`; zero recorded browser errors, failed requests or asset failures. |
| Complete original-image inspection | **491 current originals**, all opened individually at original resolution: 472 matrix, eight read warnings, three scroll and eight final deployment originals. Exclusive reviewer inventories 122/150/92/108 cover the matrix; every current filename/SHA matches, with no missing, duplicate or changed original. No new demonstrated unapproved visual difference remained. This does not certify word-by-word guide proofreading or a complete accessibility audit. |
| Genuine installed-folder replacement and copy-back | **Chromium and Firefox passed all four checks each**. Complete A/B packages use matching production client/SSR; all 22 old hashed paths are absent in B. Dirty compatible edits survive and finish before reload; an actual retired lazy module 404 produces exactly one clean reload, subsequent SPA navigation uses B, and copy-back A retains both persisted rows. All 192 native static files retain exact bytes through each run. |
| Normal source workflow | **3/3 browser cases**, 13.9 seconds, through actual root `npm run server`: executable source assets, prehydration draft and held-locale navigation, and a real Packing command in the same document. Genuine CSS HMR application/restoration preserved the original document; authored-input generation completed before the normal server restarted and hydrated Help. The harness exited zero, restored CSS bytes/locale times, and stopped only its owned process tree. |

Final runtime transcripts, source snapshots, dependency provenance and per-original review inventories are ignored
local evidence under `.temp/frontend-foundation/full-rectification-acceptance5-*`. The single ignored
`full-rectification-acceptance5-visual-reconciliation.json` joins all 491 inspected originals to their actual current
hashes. The `acceptance5-development-restored` fingerprint matches the predevelopment final runtime; all 544 frozen
authored inputs remain unchanged. The final content check also verifies all ten runtime/content directory digests,
29 captured executable/style/chunk hashes, the exact 192-file native static inventory with no extra files, and all
24 actual type contracts as declaration files. The owned package, capture, built-browser and source-server
listeners are stopped.

The deployment fixture exposed additional verification failures and preserved them. An enabled IDE **Project Files**
Sass watcher reacted to ignored copied authoring files and changed compiled CSS after the first copy. Actual Firefox
image inspection found its error block despite the behavioral process exiting zero. The complete payload and its
copy-back backups were therefore recreated in an owned OS-temp folder outside that IDE scope, without removing
release files or changing IDE/application configuration; exact native-static hashes are asserted around replacement.
An external Chromium attempt then let ordinary session observation update its clean document before the intended
cold import. Another Firefox attempt had stopped A before its progressively loaded collector admitted a usable card:
the module-response waiter failed while the click still awaited a missing action. The retained original and request
history establish these distinct fixture premises. The final fixture waits the real card and completed regions,
asserts the original A document immediately before navigation, and may hold only its actual external session reads
until the real retired import recovers. It retains the genuine 404 and exact reload assertions and releases those
reads; no application behavior was changed to satisfy the harness.

Production-only dependencies were reused from an installation with the identical current lockfile and all 33 direct
production versions verified. The private production startup forbids workspace dependency fallback and succeeds
without development packages even when the development flag is set. A fresh `npm ci` is not claimed. Browser
deployment journeys run the compiled production package in the established E2E mode against the restricted
disposable schema; they do not constitute an actual production deployment. External SMTP delivery, a live OIDC
round trip and production cutover remain unexecuted boundaries. Nonfatal localhost/npm/tool warnings stay in the
transcripts and do not become unexplained passing assertions.

### Documentation and migration follow-through

No new maintained documentation file, report registry, checklist or delivery gate was introduced. The previous
finished execution plans had already been retired into the existing pilot and paired-review records; this increment
updates those owners rather than adding another plan. Original design/baseline and approved-history records remain
necessary evidence of authorization. Prospective staged architecture/development/testing/operator replacements
remain necessary for the next modules and eventual cutover, with their canonical merge targets preserved. Unrelated
feature-design records and the exclusively native remediation backlog were not refactored or removed.

The single existing contribution recipe now requires the independent native oracle and decision ledger, actual
consumer and causal read/write boundaries, selected localization binding, semantic first-read premises, exact
accessible controls/focus/labels, wrapper/text-node geometry and scroll ownership. It distinguishes silent optional
image recovery from visible JSON Retry, a complete read receipt/deadline/explanation from timer presence, and a
confirmed denial from an unusable response. Its linked Testing Guide retains cheapest-stable-layer selection and
verified disposable database boundaries. These are the concrete changes to prevent the evidenced review failures;
another feature must reuse the established owners rather than copy an already-passing implementation as its oracle.

The final optional strict documentation report inspected 78 Markdown files and 1,505 internal links, finding no
broken links, metadata errors, missing package scripts or configured stale terms. Its advisory exit zero is not a
clean-report claim: four findings remain classified against their actual sources. The historical source baseline
predates these implementation changes; the [documentation policy](../DOCUMENTATION_POLICY.md#source-fingerprints-and-baselines)
requires retaining that history rather than replacing a hash to obtain a clean report. Two missing-path findings
refer to the deliberately quarantined adjacent JavaScript copies recorded above, not current implementation paths
or instructions to restore them. The unreferenced controls illustration is an intentional native authoring reference,
documented in [Help Visuals](../HELP_VISUALS.md#ownership) and already contained under `DOC-ENTITY-PROPERTIES-VISUAL`
in the existing [remediation backlog](../documentation-remediation.yml). Its obsolete picture remains excluded from
the guide, which supplies current written guidance. That unrelated native visual follow-up remains open; it is not
a new pilot defect or completed work. No baseline, checker exception, guide embedding or native asset was changed
to suppress these findings, and the report remains advisory.

### Migration guideline and test-cost review (2026-10-11)

This increment starts from committed correction `f45dad7`. It changes test fixtures, runner/build/CI orchestration
and existing maintainer documents; application source, dependencies, contracts, catalogs, user help and pictures are
unchanged. The coherent build remains `fa5dc669f33da4c75bb81ddd`; all ten runtime/content directory hashes match the
accepted binary. Its prior inspected originals and development/deployment evidence remain applicable to those
unchanged boundaries; they were not recaptured or rerun in this increment.

The [single migration guideline](staged/DEVELOPMENT.md#implementing-the-next-feature-slice) is now eight steps and
one review table. Its linked [risk procedure](staged/TESTING_GUIDE.md#risk-and-test-cost) selects distinct observable
risks, with conditional source/schema/deployment/visual checks. It replaces repetitive blanket verification
instructions; no maintained file, alternate checklist, controller, service or application adapter is introduced.

All 97 original application spec files were inspected across unit, frontend, integration and E2E. The optimization
removes 131 expanded cases: 91 repeated frontend rows, four unit duplicates and 36 integration duplicates. The
24-case generic service suite is removed only after transferring its meaningful assertions to existing feature
workflows. One Activity smoke called an unused exported DBAL helper; its replacement protects the actual locked
controller path and persisted assignment identity, not that unused helper's source-function coverage. All 15 E2E
files retain their cases and assertions, including 1,926 unchanged expectation nodes in the four transport-edited
files. Twenty-five expanded cases omit an unused owner page; thirteen need no browser fixture. This is not a claim
of thirteen avoided browser-process launches, because Playwright reuses workers.

Compiled Pug functions are reused with fresh locals; neither rendered results nor mutable feature state is cached.
All eight invoice layout cases consume the shipped CSS instead of compiling identical Sass repeatedly. UTC is
explicit, database-free files remain isolated with two workers, and integration keeps one schema-owning worker.
The full build prepares contracts/catalogs once while retaining both Vue type checks and bundles; standalone
commands still prepare fresh inputs. Explicit configuration paths and the existing output-shadow guard prevent
adjacent emitted runner copies from silently changing execution. Two observed root copies were quarantined in
ignored evidence; their emitter was not established and no IDE setting was changed.

The three CI stages run whole database-free, integration and built-browser projects on independent runners.
The browser command fixes two workers instead of varying session/database pressure with half the host CPU count.
Built-in Vitest blobs replay all tasks and merge coverage into the original JUnit/LCOV paths. Successful collection
requires both project reports; separate stage copies preserve failed diagnostics. Any failed stage or merge still
blocks release/Sonar. No distinct consequential application risk or configured coverage scope was removed, and documentation
reports remain advisory. The ten-minute target is provisional; the twenty-minute stage ceiling is not a measured
hosted result.

Risk estimates have no incident-frequency dataset, so the following ordinal judgments are prioritization scores,
not numerical defect probabilities. Expected incremental harm remains likelihood × impact × unique detection
probability; exact duplicate protection is assessed against named surviving inputs/boundaries/assertions.

| Class | Likelihood × impact | Decision and cost tradeoff |
|---|---|---|
| Repeated cosmetic/identical serializer inputs | 1 × 1 = 1 | Keep representatives and distinct boundaries; remove redundant matrix execution. |
| Ordinary relationship/persistence controls | 2 × 3 = 6 | Consolidate fixtures only after transferring unique persisted fields and actor isolation. |
| Authorization, privacy, hard deletion and locked writes | 2 × 4 = 8 | Keep independent route/session/DB/race checks; duplicated names do not prove equivalent risk. |
| Invoice/money, durable settlement and widespread data loss | 2 × 5 = 10 | Keep consequential calculations, transactions, migrations and actual browser controls. |
| Previously observed pilot lifecycle/consumer failures | 3 × 4 = 12 | Keep actual consumer and retired-response assertions; timer/transport presence is insufficient. |

Independent final review caught a consolidation error before acceptance: the transferred event metadata assertions
covered disabling dietary flags but missed enabling them. The same existing fixture now verifies false→true for
both fields, without another case or schema reset. The raw-email privacy assertion had also compared against the
mailer object instead of the account email; it now checks the real private value. Newly orphaned test wrappers and
imports were removed. These findings demonstrate why test-name/function matching and an aggregate green result
cannot establish equivalent coverage: compare original input branches and observable assertions, then independently
review the finished diff. Earlier corrective-action failures and native-layout/consumer causes remain documented
above, rather than replaced by a claim that case reduction alone prevents defects.

The first whole built-browser execution ended with 98 passes, six failures and four explicit skips. Five failures
came from this run's ignored fixture placing uploads under a hidden directory: the unchanged production file-serving
policy rejected those paths despite the files existing. The final fixture uses ordinary ignored, test-owned upload
directories. The sixth exposed an existing invoice fixture closing its breakdown during the opening transition.
Both affected openings now await the public `shown.bs.modal` event, with no delay, timeout increase, private-state
access or production change. Independent comparison confirms all four declared cases and 273 expectation
expressions in that file are retained; the actual named helpers pass strict installed Playwright type checking.
Failed diagnostics remain intact and the whole suite is rerun, rather than removing the failing assertions.

That rerun reached the financial steps previously blocked by download failures, completing with 100 passes,
four failures and four skips in 671.97 seconds. The long invoice settlement workflow now passed. Traces established
three further missing fixture premises: the touch setup clicked inside an expanding pool; the archival fixture
reopened during the prior closing transition; and the overview's exact scroll baseline included two expiring
success alerts, whose removal changed page height by 74 pixels each. Existing helpers now wait for completed public
collapse state, and the scroll fixture uses the actual **Dismiss notification** controls before measuring. The
deliberate keyboard-during-opening checks, financial/deletion assertions, exact focus/scroll tolerance and timeouts
remain. A fourth failure was an `ECONNRESET` during Drivers creation, with no response; its underlying cause was not
established and no mutation retry was added. All original assertions remain; only bounded fixture readiness checks
are added. The final whole execution below uses the actual package command with two workers and fresh guarded data.

The third execution passed all 104 ordinary cases in 439.39 seconds, but still failed overall: a session probe
received `ECONNRESET` before reaching its configuration-dependent skip, leaving three skips and one failure.
Neither reset has a proven application-level cause. An isolated probe of the installed client demonstrated API
socket reuse after the server's advertised idle deadline; the shared public Playwright header now requests
`Connection: close` for browser and API contexts, including additional actor contexts. The same probe observed
six original requests exactly once, with no reuse for consecutive requests using that header. A separate actual
Chromium check confirmed that the WebSocket handshake still upgrades and exchanges data. These bounded checks
support the transport choice without claiming that they establish the reset's exact cause. No write is retried,
and routes, cookies, payloads, cases, assertions and timeouts remain unchanged. The final whole execution uses
this setting from the start, with its own preserved report and input snapshot. This intentionally excludes pooled
idle-connection reuse from application E2E; product owners do not branch on that transport header, and independent
comparison found no lost application authorization, session, financial or browser assertion.

The fourth execution had no connection reset, but ended with 103 passes, four skips and a 120-second invoice
lifecycle timeout; overall wall time was 517.34 seconds. The retained final page shows previous credit `40.00`,
balance `30.00` and **Payment due**, following successful recalculation and page loading. Its final close waits
indefinitely for `hidden.bs.modal`; the missing/corrupt trace prevents proving the precise opening/click timing.
The strongest supported explanation is the same premature-close premise previously corrected in the pool fixture.
The already reviewed opening wait and identical closing waits now share the existing E2E keyword owner across
the affected pool, lifecycle and organizer-expense consumers. Every original financial assertion and timeout remains;
independent comparison retains all nine declarations and 869 original expectation nodes. The named browser callbacks
also pass strict installed Playwright type checking after correcting the inferred event literals.
The guideline explicitly requires reviewing peer consumers of a corrected behavior: repairing one observed call
site does not establish that the same premise is sound elsewhere. This failed execution is preserved separately
from the focused correction check and final whole run below.

The final independent documentation review also corrected directly affected login/privacy references in the older
coverage map and two inherited recipe conflicts: migrated pages use the existing Vue/v1 owners, and setting tests
exercise executable behavior while maintained prose receives optional reports. These were corrected in the existing
owners. The guideline now makes native transition completion and production-valid upload fixtures explicit.

| Final review criterion | Result and bounded evidence |
|---|---|
| Vision, original design and technological choices | Completed pilot scope remains Help/Packing and necessary foundation; future modules/cutover remain explicit. Original decisions and approved amendments are unchanged. |
| Designed/implemented architecture; DRY and modularity | Existing owners, controller/DBAL separation, declaration contracts and renderer-data boundaries are unchanged; test/report reuse adds no application abstraction. |
| Human readability, comments and formatting | New nontrivial cache, runner, SSR preparation and report behavior has purposeful comments; named helpers, logical blank lines and adjacent style retained. |
| New debt and repository cleanliness | Newly orphaned helpers/imports removed; proven duplicate fixtures retired; no new maintained document or finished execution plan. Necessary original decisions and future cutover drafts retained. |
| Documentation and staged currency | Existing Development/Testing/Architecture owners updated; the older coverage map identifies its historical scope and routes current runner details to the Testing Guide. |
| Test adequacy and performance | Distinct consequential risks retained; whole execution plus final bounded corrections/merge/E2E evidence follows. No hosted timing or impossible guarantee of absent bugs is inferred. |

| Executed check | Result and limits |
|---|---|
| Full `npm run build` | Passed in 66.17 seconds; generation occurs once, both Vue type checks and client/SSR builds remain. |
| Whole `npm run test:ci` with coverage | 1,649 cases passed in 81 files: 1,312 database-free and 337 integration. Wrapper wall time 795.31 seconds; Vitest reported 774.50 seconds. This precedes the bounded final corrections described below. |
| Final affected projects with coverage | 47 unit cases and 31 integration cases passed in four files after the assertion/helper cleanup; 110.24 and 164.69 seconds including preparation/reporting. |
| Real built-in report replay | Both actual project blobs merge in 28.60 seconds without rerunning tests; all 78 cases and 267 coverage files retained. Exact coverage-map union, Vue/TypeScript LCOV and combined JUnit verified. |
| Failed report replay | One synthetic failed task in ignored copies returns the expected exit 1, retains 78 cases/one failure and the exact coverage map. Genuine task inputs/results are unchanged; the synthetic report is retained only in ignored evidence. |
| Focused invoice lifecycle and helper compatibility | The previously timed-out financial workflow passed: 29.5 seconds for its case, 51.35 seconds including preparation. Final shared helpers pass strict installed Playwright type checking; the type-only event literals do not change browser behavior. |
| Final whole Chromium E2E | Passed with 104 cases and four explicit configuration-dependent skips; zero failures or flaky cases. Wrapper wall time 442.28 seconds, Playwright 440.25 seconds. This actual package execution covers all final modal consumers and the shared transport setting against fresh guarded data. |
| Source, artifact and independent reviews | All 399 application inputs, ten runtime/content hashes, 29 captured executable/style/chunk hashes, 192 native static files and 24 declaration contracts match accepted evidence. All 536 final test/build inputs remain frozen during execution. Independent source/criteria reviews and whitespace checks pass. |

Exact removed-to-retained mappings, immutable input hashes, failed diagnostics, build/test timings and report
integrity evidence remain ignored under `.temp/frontend-foundation/test-cost-*`. The full coverage execution
preceded four bounded test/helper cleanup files and the CI collection change; final focused executions and
report verification cover those changes. The later invoice modal synchronization and keyword reuse are covered by
the focused lifecycle check, strict helper typing and final whole E2E execution. Application artifacts remain identical,
so another full visual or installed-folder replay would repeat unchanged-boundary evidence. Coverage instrumentation,
reporting, fixtures and machines differ from earlier
non-coverage runs; no percentage wall-time improvement or hosted ten-minute result is inferred from case reduction.
GitHub Actions/Sonar, live OIDC/SMTP and application-wide cutover were not executed in this increment. The source-only
development cases and disabled-authentication configuration case retain their explicit separate fixtures; their
unchanged prior verification remains distinct from the ordinary built suite.

The optional strict documentation report reviews 78 Markdown files and 1,516 internal links with no broken links,
metadata errors, missing package scripts, stale terms or reference-count mismatches. Four findings retain their
existing disposition: the historical source baseline, two historical references to quarantined JavaScript copies,
and the intentionally retained native controls illustration under `DOC-ENTITY-PROPERTIES-VISUAL`. Neither a clean
baseline nor completed native visual remediation is claimed. The three expected-reference counts were reconciled
only for references removed from the guides; no new exception, baseline replacement or checker-logic change was
introduced. Reports remain advisory. Existing ignored artifact logs were preserved, and the owned synthetic JUnit
failure report was moved into ignored evidence without altering it.

Automatic approval review rejected an initial permission-test consolidation because it stated that high-risk
authorization coverage could be removed. No rejected edit was applied; narrower edits preserved those assertions
and the independent review/execution above checks their retained boundaries.
