# Frontend migration edge cases
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: current
last-verified: 2026-10-04
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: second-pass source and test-assertion review of special-use cases, browser state, permissions, lifecycle, participation and financial workflows; separates implemented protection, known defects and future SPA acceptance scenarios; no application suites or new browser capture executed in this pass
source-anchors: src/public/js/core/http.ts; src/public/js/shared/alerts.ts; src/public/js/modules/entity-properties.ts; src/public/js/modules/entity-select.ts; src/public/js/modules/timezone-select.ts; src/public/js/modules/entity-header.ts; src/modules/lib/fileCommons.ts; src/controller/helpController.ts; src/routes/; src/middleware/; tests/frontend/; tests/integration/; tests/e2e/; docs/backlog/documentation-remediation.yml
next-review: frontend-migration-contract-and-first-feature-slice
-->

This second pass supplements the [behavior inventory](BEHAVIOR_INVENTORY.md). It records cases that a uniform
component model could accidentally flatten: a filtered-out selection, a permission revoked while editing, a pending
financial change, or an identity transition are distinct states with different consequences.

The application-source baseline remains `7ff78998667e55df56390a8e8da88e8ace687771`. Evidence is implementation and test
source review. Existing assertions were inspected, not executed in this pass. The earlier
[visual baseline](VISUAL_BASELINE.md) covers representative states and does not validate all cases below.

## Domain records

| Record | Stable IDs | Scope |
|---|---|---|
| [Identity, permissions and lifecycle](IDENTITY_LIFECYCLE_EDGE_CASES.md) | EC-ID | Accounts/guests/profiles, tokens and returns, cumulative authority, overview membership, archive/restore/hide/delete, property changes and event links |
| [Participation](PARTICIPATION_EDGE_CASES.md) | EC-PART | Surveys, packing, drivers, registration, dates, activity requirements, assignments and recommendations |
| [Invoice pools and settlement](INVOICE_EDGE_CASES.md) | EC-INV | Pool states, attribution, uploads, revisions, saved balances, takeovers, payments/refunds, rollback, proof, email and exports |
| Shared browser and output cases below | EC-UI | Response confirmation, drafts, selectors, notifications, files, help and separate output navigation |

Each migration slice should cite the relevant behavior IDs and edge-case IDs. Keep the existing successful outcome,
authorization and failure/recovery behavior explicit when replacing a reload or server-rendered component. A source
check is not proof of a passing browser workflow; use the stated evidence and gaps to select the cheapest appropriate
application checks. This record remains advisory documentation, not a new CI or release prerequisite.

## Shared browser state and commands

### EC-UI-01 — A successful HTTP request can contain a login page

**Trigger:** a session expires while a mutation is pending, or a redirect yields HTTP 200 HTML. The current
[HTTP helper](../../src/public/js/core/http.ts) supports both JSON and text reads and follows redirects. It does not
universally require an API success envelope. Commands using `assertSuccessfulResponse` require explicit
`status: success` before discarding drafts or refreshing. The
[error handler](../../src/middleware/genericErrorHandler.ts) also distinguishes API JSON, expected-message HTML and
form-validation rendering; not every error body is JSON.

**Preserve:** an unconfirmed response must not be displayed as a saved change. Keep the draft and offer recovery;
do not replay a non-idempotent mutation merely because authentication was renewed or the response was lost. Current
callers are not uniformly protected, so transport modernization must inventory them rather than assume the helper
already enforces this everywhere. Multipart commands retain the browser-generated boundary instead of sending JSON
headers for `FormData`.

**Evidence:** [permission-matrix tests](../../tests/frontend/permission-matrix.spec.ts) and
[archive tests](../../tests/frontend/entity-archive.spec.ts) explicitly cover unconfirmed HTML responses. Invoice
uncertain-result handling is covered in EC-INV. There is no general long-lived SPA session/retry test yet.

### EC-UI-02 — Property omission differs from an explicit empty or false value

**Trigger:** a title-only editor saves, a checkbox is unchecked, or the deadline timezone changes. The
[property dialog](../../src/public/js/modules/entity-properties.ts) submits only changed, named, enabled fields that
were originally rendered with authority. Checkboxes send explicit `on`/`off`. A timezone change also submits the
displayed local deadline; an unrelated save omits both, preserving the persisted instant. Empty patches report that
there are no changes rather than issuing a write.

**Preserve:** absent fields must not become default values, false must not disappear during serialization, and a
whole-object PUT must not overwrite fields the editor neither changed nor had permission to edit. The server remains
authoritative. Ordinary property edits do not have a universal client revision precondition; EC-ID explains the
narrower current stale-context checks.

**Evidence:** [property rendering tests](../../tests/frontend/entity-properties.spec.ts),
[property integration tests](../../tests/integration/entity-properties.spec.ts) and
[browser property journeys](../../tests/e2e/entity-properties.spec.ts) cover narrow grants, forged fields, cancellation
and rejected drafts. General same-field conflict resolution between old forms is additional SPA work.

### EC-UI-03 — A settings dialog can contain several independent unsaved drafts

**Trigger:** editing General, then switching to Permissions, Linked event or Image, then issuing a command. The
[dialog host](../../src/public/js/modules/entity-properties.ts) retains each section's original values across tab
changes. Picker searches and audience navigation do not count as edits. A write resolves other sections' dirty drafts
with a discard confirmation; cancelling that confirmation sends no command. Closing the dialog discards all section
drafts and restores hidden selector values and their visible labels. Unloading a dirty page warns unless an accepted
navigation or successful command is already leaving.

**Preserve:** do not silently save hidden drafts, discard them on tab change, or let a background refresh recapture
edited fields as authoritative originals. Opening an export or using a modified click leaves the draft page open and
must not suppress its later unload warning. These different actions must not share one indiscriminate router guard.

**Evidence:** the archived-link browser case in
[entity-properties.spec.ts](../../tests/e2e/entity-properties.spec.ts) rejects cross-section draft loss and then checks
the saved title, discarded link selection and later successful relinking. Modified-click and complete SPA-router
guard coverage were not established in this pass.

### EC-UI-04 — Pending locks apply to the dialog, including controls created by a late read

**Trigger:** Save is pending while an event-picker search returns. The
[dialog](../../src/public/js/modules/entity-properties.ts) locks controls, prevents dismissal and repeated commands,
sets `aria-busy`, and remembers each control's prior disabled state. Failure restores that state and keeps the draft.
The [event picker](../../src/public/js/modules/entity-select.ts) derives the disabled state of newly rendered buttons
from its submitted hidden field; a deferred search resumes when a failed write unlocks the dialog.

**Preserve:** late reads must not re-enable editing during an in-flight write, and failure must not enable controls
that were disabled before the command. Successful relinking refreshes permission, admission and inherited archival
state together, including the server's redirect when the current page is no longer accessible.

**Evidence:** [entity-select tests](../../tests/frontend/entity-select.spec.ts) cover late results and deferred searches
during failed writes; [property E2E](../../tests/e2e/entity-properties.spec.ts) holds a real denied request to inspect
pending controls and retained drafts. Replacement components need equivalent teardown/late-response checks.

### EC-UI-05 — Browsing event choices is not changing the selected event

**Trigger:** the saved or draft selection is absent from a filtered page, an authorized page is empty but has a next
cursor, a request fails, or the user resets filters. The
[event picker](../../src/public/js/modules/entity-select.ts) keeps selection in one hidden field, independently of
displayed results. It preserves both saved and current selections, supports an explicit No event choice, keeps the
archived warning, and never selects the first result automatically. Empty batches with a next cursor remain navigable.

Pages replace rather than append results. Only current-page and selected data are retained; previous cursor history
is bounded. A failed Next/Previous request retains its current page and retry direction. Filters start new cursor
history. Search invalidates old results during debounce, before the next request starts. Disposed pickers ignore
late responses and remove observers/listeners.

**Evidence:** [entity-select tests](../../tests/frontend/entity-select.spec.ts) assert these cases, including thousands
of results, duplicate rows, retry, reversed date filters, and standalone-versus-inline dialog closing. Migration
must retain these outcomes even if the pagination library and DOM implementation change.

### EC-UI-06 — A valid persisted timezone may be missing from the browser's canonical list

**Trigger:** a saved alias such as `US/Eastern`, a browser without `Intl.supportedValuesOf`, an invalid display-reference
date, or a native form reset. The [timezone picker](../../src/public/js/modules/timezone-select.ts) retains valid
persisted/common/guessed aliases and UTC, falls back to common zones, and calculates offset labels for the supplied
reference instant, including DST. A bad reference date omits the offset label without blocking valid selection.

**Preserve:** initialization and repeated selection do not emit a dirty edit; valid aliases must not silently normalize
into a changed deadline. Search scans the complete inventory while rendering at most 200 choices and explaining
truncation. Closing an inline picker does not close its parent modal; it clears search and returns focus. Native reset
and parent cancellation restore the saved hidden value and all labels. Enter in picker search does not submit the form.

**Evidence:** the timezone case in [entity-select tests](../../tests/frontend/entity-select.spec.ts) checks the alias,
offsets, clean initialization, explicit change, disabled input, guessing and reset. The fallback inventory and invalid
reference-date paths are source-reviewed; dedicated browser/locale coverage was not established.

### EC-UI-07 — Transient feedback and persistent status have different lifetimes

**Trigger:** a hidden message becomes visible, existing feedback is renewed, unrelated DOM content changes, or the
browser restores a page from its back/forward cache. The [alert owner](../../src/public/js/shared/alerts.ts) expires
transient alerts after ten seconds, starts a fresh interval for renewed content, and preserves `role=status` and
`status-notice` regions. Hidden alerts do not expire before display. Unrelated mutations do not prolong other alerts;
conversion to persistent status cancels a timer. Removed nodes and disposed observers release timers.

**Preserve:** pending progress and durable warnings must not become expiring toast messages. Display server text as
text, keep modal feedback inside its context, and preserve useful success feedback through route transitions.
[Notifications](../../src/public/js/notifications.ts) stop on pagehide and restart for persisted pageshow; SPA mount
and unmount must supply equivalent lifecycle ownership without accumulating listeners.

**Evidence:** [alert tests](../../tests/frontend/alerts.spec.ts) assert timer, hidden/status and literal-text behavior.
Actual screen-reader announcement and SPA navigation/focus behavior still require focused browser verification.

## Files, links and separate outputs

### EC-UI-08 — Header-image replacement is a file operation with failure ordering

**Trigger:** selecting no file, replacing an existing image, deleting it, or a database update failing after upload.
[Header commands](../../src/public/js/modules/entity-header.ts) report missing selection before starting a write,
share dialog pending/error behavior and require explicit success. Server permission middleware runs before
[upload parsing](../../src/middleware/entityHeaderUpdateHandler.ts).

The [file owner](../../src/modules/lib/fileCommons.ts) allows JPEG/PNG/GIF headers using independent extension
and declared MIME allowlists, limits files to 10 MiB, and chooses server filenames. It does not compare an extension
to its corresponding MIME type or inspect file contents. On failed persistence it attempts to remove the new file;
only after a successful reference update does it attempt to remove the old one. Removal is asynchronous and best-effort.
Image removal is distinct from archiving, which retains files. Invoice proofs have their own authorization and lifecycle.

**Evidence:** [property E2E](../../tests/e2e/entity-properties.spec.ts) compares uploaded survey-header bytes and checks
404 after removal. Failed persistence cleanup, oversized uploads and each rejected type are source-reviewed paths;
no newly executed file-boundary test is claimed. Preserve supported formats, size and ownership through SPA multipart
transport; do not infer that every media surface supports the same formats.

### EC-UI-09 — Copying a registration link and consuming it are separate operations

**Trigger:** create, copy, expire or revoke a late-registration link; clipboard API unavailable or denied. The
[link component](../../src/public/js/modules/reg-links.ts) builds row-copy URLs using `regToken`, encodes the event and
token, disables Copy for inactive links, and confirms revocation. Its clipboard helper supports a legacy copy path
when the modern API is unavailable. Clipboard success is not evidence of registration or token consumption.

**Preserve:** copied URLs must use the real token and survive the authorized identity-entry flow. Current source has
two separate defects: IMP-035 concerns the newly created link's automatic copy; IMP-010 concerns first-time guest
onboarding losing the token. Both are in the [central register](../backlog/documentation-remediation.yml), not desired parity.
Dedicated create/copy/use/revoke browser assertions and clipboard-denial recovery were not established in this pass.

### EC-UI-10 — Separate documents and new tabs are part of the workflow

**Trigger:** exporting from a settings dialog with unsaved changes, following an email link, or loading an old deep
URL directly. [Activity export](../../src/routes/activity.ts) serves print-friendly HTML;
[event export](../../src/routes/event.ts) serves PDFs with route-specific authorization. The participant PDF is served
inline; invoice-share PDFs use a no-store attachment response and download filename. Preserve those distinct
dispositions. Do not route every click
through SPA page navigation, convert every output to JSON, or discard the originating dialog's drafts.

**Preserve:** document downloads/printing, filenames, complete authorized output data and direct route entry. Invoice
export variants, saved calculations and email semantics are detailed in EC-INV. The
[coverage map](TEST_COVERAGE.md) distinguishes PDF-definition assertions from rendered output inspection. Long names,
notes, page breaks and narrow-window print controls remain representative output checks, not established by the
first-pass page screenshots.

### EC-UI-11 — Help has stable fragments and a fixed trusted source

**Trigger:** repeated headings, Markdown links with query/fragment suffixes, missing guides/assets, unsupported markup,
or contextual help after client navigation. The [help controller](../../src/controller/helpController.ts) creates
stable heading IDs with suffixes for duplicates, includes second/third-level headings in the contents list, rewrites
maintained Markdown links to help routes and packaged images to the asset route. Contextual links depend on the
current application path. A client router must update that context and honor document fragments.

Only fixed release-shipped help is trusted. Raw HTML outside the permitted metadata comment, unsafe URI schemes,
protocol-relative links and unapproved image paths are rejected; this is not a general arbitrary-Markdown sanitizer.
[Asset routes](../../src/routes/help.ts) reject missing/invalid files and set `nosniff`. Help images and entity header
images have different allowed formats. Missing named guides return 404; the help index has an empty-content fallback
if its source is unavailable. IMP-034 separately records the missing browser title.

**Evidence:** [synthetic help tests](../../tests/unit/help-documentation.spec.ts) check source boundaries, traversal,
HTML/URI rejection, ordinary links, headings and contextual mapping. The
[help browser test](../../tests/e2e/help-experience.spec.ts) checks an account-page help destination only; it does not
test the guide corpus or SPA fragment restoration. Keep runtime trust tests independent of maintained prose.

### EC-UI-12 — Help search, validation limits and rate limits remain meaningful

**Trigger:** empty or oversized search, non-string query values, a zero-result query, a throttled identity search or
temporarily unavailable recommendation work. Help uses a native GET query, whitespace normalization, 100-character
bound and at most 20 ranked results; all search terms must match. Matching headings produce fragment destinations,
not just guide-home links. Non-string `q` becomes empty in the [route](../../src/routes/help.ts).

Other boundaries differ: [body parsing](../../src/app.ts) limits JSON/form bodies to 1 MiB;
[user lookup](../../src/middleware/adminApiFactory.ts) and
[guest-email lookup](../../src/routes/api/users.ts) have distinct per-IP rate limits. The
[error handler](../../src/middleware/genericErrorHandler.ts) supplies `Retry-After` for qualifying API 503 errors.

**Preserve:** do not misreport a denied/throttled/failed lookup as a valid empty result or poll these endpoints as if
they were unrestricted entity reads. General structured-error and retry treatment needs the new API contract; it is
not uniformly available in current browser helpers. Help search ranking/limits and generic throttling display lack
dedicated assertions in the reviewed application tests; use synthetic fixtures and focused transport tests when moved.

## Cases to add when removing reloads

These are acceptance scenarios derived from existing boundaries and the user's SPA requirements. They are not claims
that general periodic refresh or conflict merging already exists:

| Scenario | Required outcome to carry into foundation design |
|---|---|
| A refresh finishes after profile switch, logout, navigation or unmount | Ignore the obsolete response; do not expose the previous identity's data, grants or drafts. Type-qualified entity identity and active-profile scope remain distinct. |
| Shared data refreshes while a form is dirty | Retain the local draft and its original comparison state; update read-only information without silently replacing edited fields. Revalidate current authority and lifecycle at save. |
| Another client edits the same data or changes event association | Respect existing revision/expected-context checks; design the missing ordinary-field conflict policy explicitly. A transaction lock alone does not prove protection against an old browser form. |
| A mutation times out after reaching the server | Treat the result as uncertain until reconciled with authoritative state. Retry only according to the endpoint's idempotency/reconciliation contract: packing/driver self-assignment already suppresses duplicates, while invoice submission has no established server idempotency key. |
| A command succeeds but affects other projections | Refresh dependent permissions, admission, inherited archive state, overview membership, counts and financial summaries together as appropriate; local button state is not the authoritative record. |
| Polling overlaps search, picker pagination or a reviewed preview | Prevent older results from replacing newer state. Keep selected values, focus/caret and reviewed revision separate from transient query results. |
| Back/Forward, an email deep link, fragment or modified click is used | Restore meaningful page context without discarding unrelated drafts; preserve external authentication and separate output-document navigation. |
| A new locale is selected | Translate display and messages from the common catalog without translating stored enum values, permission bits, field names, route parameters or numeric/date contract values. Preserve distinctions between civil dates, local deadline input and instants. |

The source-backed domain records identify which protections already exist and which cases need further evidence.
Do not label all failures as conflicts, all pending financial values as saved values, or every existing API write as
revision-protected when designing shared components and contracts.

## Second-pass verification

The four edge-case records contain 121 distinct case IDs. Local links, required metadata, case-ID uniqueness and
defect-register YAML were checked. The optional documentation report found no broken links or missing documented
paths/scripts; its existing source-baseline, temporary-file metadata, older source-anchor and help-asset findings
remain advisory. The report is under `test-results/frontend-baseline/second-pass-documentation-report/`.

Application source, tests, configuration and database contents were not changed by this second pass. No application
suite, build, browser capture or external service was executed for it. First-pass build/capture results remain
separately scoped in the visual baseline.
