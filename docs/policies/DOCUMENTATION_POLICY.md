# Documentation Policy

<!--
documentation-metadata
audience: maintainers; documentation contributors; AI agents
owner: documentation maintainers
status: current
last-verified: 2026-10-12
verification-baseline: docs-baseline-2026-09-06-ci-repair
verification-scope: explicit 2026-10-12 maintainer restoration of canonical classifications, adjacent native/localized user docs and prior-approval rules; existing advisory reporting and native Help trust remain unchanged
source-anchors: scripts/check-documentation.mjs; scripts/tests/documentation-check.test.mjs; repository-tree; src/controller/helpController.ts; src/routes/help.ts; src/views/help.pug; .github/workflows/release.yml; docs/decisions/DEC-004-HELP-MARKDOWN-TRUST-MODEL.md; docs/policies/documentation-check.json; docs/backlog/documentation-remediation.yml; scripts/check-help-documentation.mjs; docs/features/help/HELP_VISUALS.md; tests/unit/help-documentation.spec.ts
next-review: documentation-pipeline-or-help-trust-boundary-change
-->

This policy defines where Surveyor documentation lives, how the intended current working implementation is
established without erasing deliberate feature differences, how transient implementation defects are isolated, how
documents record their verification state, and how optional review reports support maintenance without gating application delivery.

## Documentation is never a delivery gate

Documentation must not block CI, builds, merges, releases, or deployment. This includes completeness, wording,
metadata, links, images, baseline fingerprints, semantic documentation tests, and operator-documentation rehearsals.
Do not require a documentation status check, make an application job depend on a documentation job, or add a
documentation prerequisite to an install, build, test, release, or Git hook. Do not make documentation completion a
condition for approving or delivering an otherwise acceptable application change.

Documentation standards remain useful maintainer guidance. Record discrepancies and follow-up work; do not suppress
findings or call an unexecuted check successful. Historical migration references to a documentation "gate" now mean
advisory review evidence only; they do not override this policy.

Application correctness is separate: authentication, authorization, database safety, and help-renderer security tests
continue to protect executable behavior. Help-runtime tests use synthetic fixtures, not maintained guide text or images.
The runtime rejection of unsafe help content is unchanged by the advisory reporting policy.

## Policy authority and changes

The maintainer's explicit decisions govern policy. This includes documentation structure, source locations,
audiences, architecture, technology choices, security boundaries, design documents and migration acceptance criteria.
Executable code establishes what currently happens; it does not authorize changing an approved policy or design.
If instructions, policy, design or implementation conflict, inspect the evidence and ask the maintainer directly
before dependent implementation. Continue independent authorized work while the decision is pending.

This includes a new request that contradicts an existing canonical name, approved design or policy. A newer phrase
alone does not resolve the conflict: identify both sources and ask explicitly which decision governs. Proceed only
when the maintainer explicitly identifies and resolves that conflict; do not treat a suspected typo as a policy change.

Every policy or design decision change requires explicit approval in the conversation. Do not silently rewrite a
decision, infer approval from a cleanup request, or bury implementation plans or approval requests in documentation.
After approval, retain the original choice and record one concise dated amendment with its scope and provenance.
Editorial corrections and authorized relocation do not reopen unchanged technical decisions.

All AI agents must read this policy and the [development policy](DEVELOPMENT_POLICY.md) at task start and apply them
to every touched boundary. The delegating agent passes the actual authorized scope and unresolved conflicts to each
subagent and reviews its result; delegation never grants permission to override a policy. AI instruction files route
to these policies rather than maintaining competing rules. New findings are reported truthfully, without invented
approval or silent updates to the design.

## Canonical locations

| Material | Canonical location | Notes |
|---|---|---|
| In-app end-user help | [`docs/user-guide/`](../user-guide/) | This is the only supported user-help source directory. `helpController.ts` reads it directly, and releases copy it with `docs/`. |
| Defined operational/development guides and index | [`docs/`](../) | Only the explicit root allowlist below. This directory is not a general destination for documents. |
| Policies | [`docs/policies/`](./) | Authoritative documentation/development rules and their advisory configuration. |
| Architecture decision records | [`docs/decisions/`](../decisions/) | Original choices, rationale and approved dated amendments. |
| Feature/layer design and references | [`docs/features/`](../features/) | Durable specialist material for its intended maintainer audience. |
| Temporary migration documentation | [`docs/frontend-migration/`](../frontend-migration/) | Plans, baselines, migration status, pilot records and staged technical guidance for the migration's duration only. |
| AI-agent summaries | [`AGENTS.md`](../../AGENTS.md) and [`.github/copilot/`](../../.github/copilot/) | These are summaries, not an independent source of behavioral truth. |
| Migration state | [Documentation migration status](../frontend-migration/DOCUMENTATION_MIGRATION_STATUS.md) | Human-readable continuation point and run evidence. |
| Machine-readable backlog and defect register | [`documentation-remediation.yml`](../backlog/documentation-remediation.yml) | Open findings/defects, durable decisions, acceptance criteria and concise closed-ID/package dispositions. |
| Advisory report configuration | [`documentation-check.json`](documentation-check.json) | Baselines, metadata rules, and explicitly deferred stale-term debt. |

Do not introduce an alias directory for end-user help. Code, links, release packaging, and contributor instructions must
all use `docs/user-guide/`.

The native English reference is directly under `docs/user-guide/`; pilot/translated articles and assets live beside it
under `docs/user-guide/en/`, `docs/user-guide/de/` and further approved catalog directories. There is no second Help
root. Migration/staged documents are never runtime Help input. Prefer localized Help; missing localized content uses
reviewed English with visible disclosure, as recorded in the staged technical amendment.

The exact permitted filename inventory is defined once in
[`documentClassification.rootAllowlist`](documentation-check.json), alongside this policy. It contains only the nine
defined operational/development guides and index; changing it also requires explicit policy approval. The index routes
readers rather than accumulating implementation history or feature plans. Reports consume this policy inventory and
do not authorize adding a document or changing a classification.

Classify existing material before moving it. Backlog records belong under `docs/backlog/`; formal decisions go only
under `docs/decisions/`; permanent feature/layer designs go under `docs/features/`; migration-only material goes only
under `docs/frontend-migration/`. Do not create aliases, duplicate copies or extra root documents. Review anything
outside these classifications and request approval with the exact file list and reasons before removing it. Reports
must never delete or rewrite material automatically.

The maintainer's subsequent 2026-10-12 correction explicitly restores the original `docs/user-guide/` path. The
intermediate rename followed a mistaken directory name without resolving its conflict with the canonical source;
that was a process violation, not an approved design precedent. The separate pilot Help root was also unauthorized.
The approved cleanup removes only the obsolete unreferenced illustration and the maintainer-only Activity Help
paragraph. The remaining article bodies/assets and trusted-content model are preserved.

## User-facing content boundary

For every change, identify the affected end-user, maintainer, operator and AI guidance; update it appropriately or
record a follow-up. Verify exact labels and available actions against rendered views and browser behavior. Help is
task-first: give novices the shortest successful procedure before recovery, privacy, roles and advanced details.
Preserve deliberate feature exceptions rather than infer capabilities from peer modules.

Help prose, captions, alt text and picture pixels in every language explain tasks, observable behavior and exact
visible labels. Do not expose framework/architecture/API details, source paths, storage keys, permission identifiers
or how the application/illustration was generated or verified. Describe access through recognizable roles/actions.
Keep provenance, source references and verification evidence in maintainer records or ignored authoring artifacts.
The hidden metadata comment may contain maintainer anchors and must remain absent from rendered Help. Inspect each
language's text and pictures independently; a translation does not establish the suitability of its original.

## In-app help trust boundary

The in-app guides are trusted, application-shipped content. The help controller reads the fixed `docs/user-guide/`
directory, and the release workflow packages those files with the application. Surveyor does not treat this directory as
a user-editable knowledge base, upload destination, tenant content store, or remote feed.

Because converted Markdown is inserted into the help view as HTML, changes to the user guides are security-sensitive and
must receive the same review as source changes. Only reviewed content shipped with the matching release may be placed in
that directory. Operators must not overlay it with storage writable by ordinary users, guests, organizers, tenants, or
an untrusted service.

Authors should use Markdown. The required `documentation-metadata` HTML comment is allowed; active raw HTML, scripts,
event-handler attributes, embedded documents, executable forms, active styling, and unsafe URI schemes are not part of
the authoring contract. Generated or AI-assisted content still requires maintainer review before release.

Runtime sanitization is not the controlling boundary while the source remains trusted application content. Any proposal
to load help from uploads, a database, an administrator editor, a tenant-managed directory, a network source, or a plugin
must first reopen [DEC-004](../decisions/DEC-004-HELP-MARKDOWN-TRUST-MODEL.md) and implement an appropriate sanitization and
URI-allowlist strategy before enabling that source.

## Evidence and documentation contract

Use evidence in this order:

1. **Feature-specific executable behavior and tests:** routes, controllers, services, entities, views, browser code, package scripts, and workflows for the feature being documented.
2. **Explicit maintainer or product decisions:** records that distinguish intended behavior, deliberate exceptions, and transient defects when code alone does not establish intent.
3. **Generated references:** tables or inventories produced directly from implementation sources.
4. **Canonical maintained documentation:** user guides, operator runbooks, architecture, development, and testing guides.
5. **AI instruction summaries:** `AGENTS.md`, Copilot instructions, and similar files.

Executable behavior is the primary evidence for what the application does. Intent still matters when deciding whether
a difference is a stable feature boundary or a defect. Shared middleware, a common entity registry, or repeated peer
behavior does not by itself prove that every feature must consume the same capability. Verify the feature-specific
view, controller, routes, persistence, tests, and an explicit maintainer decision before classifying an omission.

Deliberate feature differences are part of the current working implementation and must be documented. Transient
defects are tracked separately and product documentation assumes they have been corrected. A lower-ranked source must
link to the higher-ranked source rather than duplicate volatile details.

## Change boundary for this migration

The documentation migration is documentation-only by default. A documentation package may inspect application source,
tests, examples, and workflows as evidence, but it must not alter runtime behavior to make the documentation easier to
write.

When implementation evidence contains a transient defect, the active run must:

1. verify the intended working contract from feature-specific behavior, tests, and, when needed, an explicit maintainer or product decision;
2. record the defect once in the `implementation_defects` register in `docs/backlog/documentation-remediation.yml`;
3. keep defect details in migration-control material only, such as the backlog, decision records, and migration status;
4. write end-user, operator, maintainer, and AI documentation for the corrected working contract without copying the transient defect, warning, or workaround into those documents; and
5. leave application remediation for a separately authorized change set.

Before creating a defect, check whether the difference is intentional. A confirmed exception must be documented as
stable behavior and must not remain in the defect register. If neither intent nor a coherent working contract can be
established, keep the behavior decision open and do not make the affected product documentation authoritative.

The only source exception is an explicitly scoped change to the in-app help integration itself. Such a change must be
named in the active package before source files are edited; a general documentation package does not imply permission
to modify application source, runtime tests, environment examples, configuration defaults, package files, builds, or
workflows.

## Required document metadata

Every maintained Markdown document except `LICENSE.md` starts immediately after its title with an invisible
`documentation-metadata` comment. The structural checker requires these fields:

```markdown
<!--
documentation-metadata
audience: intended readers
owner: role responsible for updates
status: current | migration-pending | historical
last-verified: YYYY-MM-DD
verification-baseline: registered baseline identifier
verification-scope: structural | behavioral | structural-and-process
source-anchors: path; path; repository-tree
next-review: work-package or behavior-decision identifier, or none
-->
```

The fields mean:

- **audience:** who should be able to act on the document.
- **owner:** a role, not a person, that is responsible for keeping it current.
- **status:** whether the content is authoritative, awaiting its assigned migration package, or intentionally historical.
- **last-verified:** the date on which the stated verification scope was completed.
- **verification-baseline:** an identifier registered in `documentation-check.json`; each baseline is tied to a source fingerprint.
- **verification-scope:** what was actually checked. `structural` never implies that behavioral instructions are correct.
- **source-anchors:** existing repository paths used for verification. Separate multiple anchors with semicolons.
- **next-review:** the work package or behavior decision that owns the next review, or `none`.

Free-standing “Last updated” dates and document version numbers are not verification evidence and must not be used.

## Source fingerprints and baselines

`npm run docs:fingerprint` creates a deterministic SHA-256 fingerprint over implementation, test, build, and workflow
files. Documentation, generated build output, explicitly listed local settings, uploads, logs, and IDE metadata are
excluded. File selection is defined in the checker configuration, not by the presence of developer-generated files.
Package files, application source, documentation-checker source, tests, and workflows remain fingerprinted.

The current fingerprint format converts CRLF to LF only in valid UTF-8 text without NUL bytes. Binary inputs remain
byte-sensitive. This makes Windows and Linux text checkouts comparable without hiding changes to code or binary assets.
The normalization mode is recorded with the baseline; older raw-byte baselines remain historical evidence and are not
silently overwritten.

A baseline entry in `documentation-check.json` records:

- its identifier and date;
- the source fingerprint;
- audit/archive provenance when available; and
- the verification scope.

A document references the baseline identifier rather than copying a hash. A mismatch is a review hint that the
implementation has changed since that snapshot, not proof that documentation is wrong and not a reason to stop delivery.
Retain historical baselines and review affected source anchors when useful. Do not require a new baseline on each commit,
automatically rebaseline CI, or replace a hash merely to obtain a clean report.

## Optional documentation reports

Run these on demand; none is a prerequisite for application tests or delivery:

```bash
npm run docs:check
npm run docs:check:strict
npm run docs:check:help
```

The compatibility name **strict** requests reporting of all configured stale concepts, including any deferred items.
It does not enable enforcement. All three commands exit zero even when findings exist or a diagnostic subprocess cannot
run. They execute through `scripts/report-documentation.mjs`, which preserves child exit statuses, logs, and findings in
`artifacts/documentation/`. An advisory exit is not a claim that the documentation is correct. Inspect the JSON and
readable summaries: `clean`, `findings`, `failed`, and `tool-error` distinguish the outcomes.

The reports cover baselines, links, referenced commands and paths, metadata, source anchors, stale concepts, the fixed
help source, image authoring, and packaging. A failed structural diagnostic does not prevent the independent help report
from running. A syntax error, missing dependency, missing configuration, unavailable runner, or inability to write a
report is surfaced without becoming an application failure.

Exact generated/local-path exceptions retain their reasons and authored-reference counts regardless of whether the
optional file is present. Real missing paths and altered counts are still reported. Never commit generated files,
credentials, or private environment files just to remove a documentation finding.

Additional optional reports are:

```bash
npm run docs:test:tooling
npm run docs:test:content
npm run docs:test:browser
```

Tooling tests need only Node.js. Content tests need the installed development dependencies. Browser checks reuse the
built application and guarded disposable E2E database; see the [Testing Guide](../TESTING_GUIDE.md) before running them.
Tests that read actual guides live in `tests/documentation/`, outside the default application test discovery paths.
No documentation report or documentation-tool regression suite is run by the required CI workflow.

The release workflow still attempts to copy the documentation, but copying and byte-comparison diagnostics are in a
separate advisory step with `continue-on-error`. Missing documentation or a packaging mismatch is visible in the log and
does not suppress archive creation. Build and other application failures remain failures.

## Per-package workflow

1. Select one ready package or the recorded next behavior decision from the [migration status](../frontend-migration/DOCUMENTATION_MIGRATION_STATUS.md).
2. Reproduce only its findings against the current source anchors.
3. Establish the feature-specific working contract from implementation evidence and any explicit maintainer decision, or keep the decision open.
4. Classify each difference as intentional behavior, a transient defect, or unresolved; do not infer uniformity from peer features alone.
5. Record transient defects in the central backlog without copying them into product documentation.
6. Change the smallest coherent documentation set; edit source only for an explicitly authorized in-app help integration change.
7. Use optional structural and semantic reports as review evidence; log anything not run.
8. Update document metadata and concise current dispositions in the machine-readable backlog/migration status.
9. Record completed work and remaining review items truthfully, without making the package a delivery prerequisite.

Newly discovered problems are recorded in the backlog with a package assignment. They do not expand the active package
unless they block truthful completion of that package.

Keep only durable decisions, open findings, concise closed-ID dispositions and latest relevant evidence in maintained
records. Superseded runs, repeated failures, file inventories and completed implementation sequences remain in Git
history and ignored run artifacts. Consolidate completed plans by transferring unique native contracts to existing
canonical owners before retiring the plan. Editorial cleanup does not authorize changed behavior or pilot technical
claims in native guidance; the [staged amendment](../frontend-migration/staged/DOCUMENTATION_POLICY.md) owns those deltas.

## In-app help authoring reports and runtime protection

The application renders only the reviewed Markdown files under `docs/user-guide/`. D14 enforces the trusted-content model recorded in [DEC-004](../decisions/DEC-004-HELP-MARKDOWN-TRUST-MODEL.md):

- The documentation metadata comment is the only raw HTML permitted in an in-app guide, and the renderer removes it before producing HTML.
- Active raw HTML, protocol-relative URLs, control characters, and URI schemes other than HTTP, HTTPS, mailto, and tel are rejected.
- Markdown links to another guide must target a maintained Markdown file directly inside `docs/user-guide/`.
- Images must use non-empty alt text and a reviewed raster file under `docs/user-guide/assets/`; remote images, data URIs, SVG, and nested asset sources are not accepted.
- Unreferenced or unsupported help assets are reported for maintainer review.
- `npm run docs:check:help` reports these rules without a database or application server. The normal and strict reports also include this advisory check.
- The release workflow attempts the copy and byte comparison in a separate non-blocking step.

These checks reject content outside the repository’s authoring contract; they are not a general-purpose sanitizer for arbitrary Markdown. Adding an editor, upload, database, tenant, plugin, or remote help source requires reopening DEC-004 and defining sanitization, URI allowlisting, provenance, and review before that source is enabled.

Maintained interface maps follow the ownership and accessibility rules in [In-App Help Visuals](../features/help/HELP_VISUALS.md).
