# Packing and help pilot comparison
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: current
last-verified: 2026-10-08
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: progressive skeleton/loading implementation, 955 database-free cases, full build and final frontend build, 21 built HTTP/browser checks and final 26 shared/content cases plus two loading browser cases and ten individually inspected final originals; FPR-01–06 migration-only runtime rectification, final 919 database-free cases and full build, 17 guarded integration cases, 19 final built HTTP/browser journeys and 32 individually inspected focused captures followed by 12 inspected correction captures; two source-browser checks preceded the final title/presentation corrections; FPR-07 native documentation preservation, staged cutover guidance, bounded bilingual navigation correction and advisory multilingual report with synthetic tooling checks; development entry/hydration/navigation repair, real source-browser and HMR/restart verification, separate production replacement proof; approved D1–D5 rectification; full 472-image paired role/state review and 15 built behavior checks; focused final identity, native and deployment smoke review; preceding accepted packing/help evidence retained separately
source-anchors: src/frontend/components/LoadingSkeleton.vue; src/frontend/styles/pilot.css; tests/frontend/frontend-loading-shell.spec.ts; tests/frontend/frontend-content-loading.spec.ts; src/frontend/composables/pageTitle.ts; tests/frontend/frontend-refresh-navigation.spec.ts; scripts/capture-frontend-rectification-readonly.cjs; docs/frontend-migration/staged/DEVELOPMENT.md; src/modules/frontendDevelopment.ts; src/frontend/app/mountPreservingDrafts.ts; tests/unit/frontend-development.spec.ts; tests/frontend/frontend-hydration-drafts.spec.ts; tests/frontend/frontend-route-recovery.spec.ts; tests/e2e/frontend-development.spec.ts; scripts/watch-frontend-inputs.mjs; scripts/capture-frontend-baseline.cjs; src/frontend/; src/routes/frontendPilot.ts; src/routes/api/v1/; src/modules/packing/api.ts; src/controller/entityAdminController.ts; src/views/modules/module_entity_header.pug; src/views/packing/packing-view.pug; contracts/api/v1/; src/locales/; docs/user-guide/de/; tests/frontend/packing-management-ui.spec.ts; tests/frontend/packing-view.spec.ts; tests/frontend/frontend-pilot-identity.spec.ts; tests/integration/packing-management-api.spec.ts; tests/e2e/frontend-pilot.spec.ts; tests/e2e/frontend-pilot-api.spec.ts; tests/e2e/frontend-identity-api.spec.ts; docs/FRONTEND_PILOT.md
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
| Identity | Own login, guest entry, registration, recovery, activation/reset, profile switching and logout use typed commands. Emailed guest links authenticate on their initial GET. OIDC retains its configured protocol callback and returns to the pilot. |
| Help localization | All ten English and ten German articles have complete instructions, equivalent language-owned figures, recovery/privacy and advanced sections. The same locale definition selects API, native help, Vue SSR, SPA, search and TOC content. Each corpus owns its stable anchors and assets without reading another language. |
| Shared presentation | Bootstrap styling and reusable Vue controls preserve native shell/table/dialog composition. The administrator picker uses the native single searchable input, not an extra selection field. |
| Dialog layout and focus | Settings use the native small-screen fullscreen layout; event selection retains its floating margins. Event search receives initial focus and Escape restores the actual invoking control on each opening. |
| Disclosure menus | Overview and navigation menus account for space above/below their trigger. Mobile collapsed navigation remains in document flow; keyboard navigation and Escape restore the trigger. |
| Stale review | Metadata Save and submit wait for explicit Review, including same-field choices. Inline conflict feedback has enough width to read within the existing mobile table scroll. |

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
Invalid login/reset submissions retain masked password drafts for correction in the SPA; the native POST-rendered
forms clear those inputs. A pristine metadata form disables Save until an editable value changes. Visible focus
outlines identify the active keyboard target. These differences preserve the underlying actions and validation.
Localized API problems can state recovery conditions more explicitly: a consumed reset link says that it is invalid,
expired or already used, while the native page says "Invalid or expired token". Both reject the link before showing
a password form. User-entered fixture text remains unchanged; file chooser wording follows the browser's locale.
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
[pilot implementation record](../FRONTEND_PILOT.md#rectification-implementation-2026-10-08). Existing business
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
are exactly its two deliberately intercepted PATCHes. The correction run records two real GET304 recovery reads
and exactly one intercepted PATCH per journey, with no replay after Review. The earlier capture also proves two
hydrated packing Refresh interactions returning GET304.

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
