# Packing and help pilot comparison
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: current
last-verified: 2026-10-07
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: independent complete packing controls and identity flows; corrected native title/description/counter baseline; prior permission-specific paired desktop/mobile comparison; focused mixed-overview and language-owned help-figure corrections; user-facing content cleanup and reference-table readability across English/German help; conditional edits and actual built-app behavior
source-anchors: scripts/capture-frontend-baseline.cjs; src/frontend/; src/routes/frontendPilot.ts; src/routes/api/v1/; src/modules/packing/api.ts; src/controller/entityAdminController.ts; src/views/modules/module_entity_header.pug; src/views/packing/packing-view.pug; contracts/api/v1/; src/locales/; docs/user-guide/de/; tests/frontend/packing-management-ui.spec.ts; tests/frontend/packing-view.spec.ts; tests/frontend/frontend-pilot-identity.spec.ts; tests/integration/packing-management-api.spec.ts; tests/e2e/frontend-pilot.spec.ts; tests/e2e/frontend-pilot-api.spec.ts; tests/e2e/frontend-identity-api.spec.ts; docs/FRONTEND_PILOT.md
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
Packing and identity require JavaScript in this slice; only help retains an implemented and compared no-JavaScript
fallback. The native navbar's unrelated contextual-Help highlighting defect is recorded once as IMP-039 in the
[remediation register](../documentation-remediation.yml); it is not reproduced in the independent router.

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
