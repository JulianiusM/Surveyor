# DEC-004: In-app Help Markdown Trust Model

<!--
documentation-metadata
audience: maintainers; documentation contributors; operators
owner: application maintainers and documentation maintainers
status: current
last-verified: 2026-10-14
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: active trusted-content decision and original enforcement history retained; selected reviewed corpora and complete English fallback aligned with shared Help owner; no runtime change
source-anchors: src/controller/helpController.ts; .github/workflows/release.yml; tests/integration/controller-smoke-workflows.spec.ts; tests/e2e/public-availability.spec.ts; docs/policies/DOCUMENTATION_POLICY.md; docs/backlog/documentation-remediation.yml; scripts/check-help-documentation.mjs; tests/unit/help-documentation.spec.ts; tests/e2e/help-experience.spec.ts; src/frontend/; src/routes/api/v1/
next-review: help-source-or-trust-boundary-change
-->

## Decision status

**Resolved: in-app help Markdown is trusted, application-shipped content.**

Surveyor renders only the maintained Markdown files packaged under `docs/user-guide/`. Those files are part of the
application release and have the same trust level as templates, browser code, and other reviewed repository content.
They are not a user-authored content type, an administrator-editable knowledge base, or a remote documentation feed.

Runtime HTML sanitization is therefore not the trust boundary for the current implementation. The controlling boundary
is that only reviewed application content may enter the help renderer. This decision remains valid only while that source
restriction holds.

## Implemented source boundary

The current help path is fixed and release-controlled:

1. `src/controller/helpController.ts` resolves the help base directory to `docs/user-guide/` relative to the application.
2. The help controller selects reviewed article corpora and adjacent assets within that fixed tree.
3. A requested document is resolved inside the selected corpus and must exist as a regular file.
4. The canonical document and versioned Help routes expose read-only `GET` operations. They provide no authoring, upload, import, or persistence endpoint.
5. Markdown is validated and converted to HTML; internal links remain within the selected Help corpus. The shared
   controller supplies rendered content to its admitted view consumer.
6. `.github/workflows/release.yml` copies `docs/` into the release artifact alongside the built application.

There is no application path that obtains help Markdown from a request body, database record, tenant-controlled file,
network location, or runtime editor. An operator who can replace files in the deployed release already controls trusted
application content and must be treated accordingly.

## Security and authoring contract

Because rendered help has the application's origin and is inserted as HTML, write access to `docs/user-guide/` is
security-sensitive. The following rules apply:

- Help changes require the same repository review and release controls as source-code changes.
- Production deployments must use the help files shipped with the matching application release. The directory must not
  be overlaid with content writable by ordinary users, guests, organizers, tenants, or another untrusted service.
- Authors should use Markdown. The `documentation-metadata` HTML comment is permitted; active raw HTML is not part of
  the authoring contract.
- Help content must not contain scripts, event-handler attributes, embedded documents, executable forms, active styling,
  or unsafe URI schemes. External destinations must be intentional and reviewable.
- Generated or AI-assisted text is not trusted merely because it was generated inside a repository workflow. A maintainer
  must review it before it becomes application-shipped help.
- Secrets, internal-only operational data, and environment-specific credentials must never be placed in the user guides.

These are source-governance rules, not a claim that arbitrary Markdown is safe. The current design is safe only when the
input remains trusted application content.

## Documentation contract

### D04 — Operator baseline

Operator documentation must state that `docs/user-guide/` is release-managed application content. Deployments should
ship it from the same release artifact as the application and keep it outside user-writable or tenant-writable storage.
It must not instruct operators to use that directory as a general-purpose CMS or mount point for unreviewed content.

### D12 — Maintainer architecture and development

Maintainer documentation must describe the fixed local source, Markdown conversion, internal-link rewriting, and HTML
insertion accurately. It must identify the trusted-content assumption instead of describing the renderer itself as a
sanitizer.

### D13 — AI instructions

AI instructions must treat changes under `docs/user-guide/` as security-sensitive code review. They must not direct an
agent to copy untrusted HTML, fetched page content, user input, or unsupervised generated output into an in-app guide.

### D14 — In-app help validation and integration

D14 must implement guardrails for the established boundary without redesigning the help system:

- replace ambiguous safety comments with the explicit trusted-content contract;
- add automated checks that reject active raw HTML and unsafe URI schemes in shipped user guides while allowing the
  metadata comment;
- retain tests for the fixed `docs/user-guide/` source, path confinement, document listing, and internal-link rewriting;
- verify that the release artifact contains the maintained guides; and
- keep runtime sanitization out of the required contract unless the content source changes.

The broader task-oriented help rewrite, visuals, and semantic workflow checks remain part of D14 after the feature-guide
packages are complete.

## Boundary-change rule

This decision must be reopened before help content can be supplied through uploads, a database, an administrator editor,
a tenant-managed directory, a network fetch, a plugin, or any other source not reviewed and shipped as application
content. Such a change requires a new threat model and an implemented allowlist and sanitization strategy before the new
source is enabled. Documentation alone cannot authorize that change.

## D14 enforcement status

D14 implements this decision at four boundaries:

1. `src/controller/helpController.ts` resolves Markdown and assets only from the fixed release-controlled `docs/user-guide/` tree, validates authored Markdown, strips the documentation metadata comment, rejects active HTML and unsafe destinations, and rewrites maintained guide and asset links.
2. `scripts/check-help-documentation.mjs` applies the same authoring contract to every guide and reports unsupported, missing, unreferenced, or inaccessible visual assets for non-blocking maintainer review.
3. `tests/unit/help-documentation.spec.ts` protects renderer behavior and security with synthetic fixtures; `tests/e2e/help-experience.spec.ts` protects the contextual application link. Checks of actual guide content, search examples, visuals, and workflow wording are retained separately in `tests/documentation/` and run only as advisory reports.
4. `.github/workflows/release.yml` attempts to copy and compare the complete user-guide tree in a separate advisory step; missing files and copy failures never block release.

This implementation does not change the decision’s central assumption: the Markdown remains trusted reviewed application content. It does not authorize untrusted Markdown merely because malformed content is rejected.

Documentation quality and packaging reports are never delivery gates. This does not relax the fixed help source or the runtime rejection of unsafe HTML and URI schemes. The [documentation policy](../policies/DOCUMENTATION_POLICY.md) governs advisory reporting and supersedes earlier before-merge gate language.

## Authorized canonical-path correction (2026-10-12)

The maintainer explicitly restores the original `docs/user-guide/` parent tree, with reviewed article corpora and
their adjacent assets. An intermediate rename applied the maintainer's mistaken name
without resolving its conflict with the canonical path; the subsequent explicit correction reverses it. Current path
references are editorially restored; the original reviewed-release-content trust decision remains unchanged.
Separate Help roots were not authorized. This correction grants no untrusted content source.

## Authorized localized source clarification (2026-10-13)

The canonical parent and trust decision remain unchanged. Each selected reviewed corpus owns its articles and
assets; the original flat English layout is not a permanent source requirement. Missing locale, article or required
figure selects only a complete reviewed English article with its own assets. Direct assets never independently
fall back across languages. The [Documentation Policy](../policies/DOCUMENTATION_POLICY.md#localized-help)
owns authoring and fallback rules; existing unsafe or unreadable sources retain their rejection boundary.

## Cutover source reconciliation (2026-10-25)

The explicitly requested P11 retirement removes the flat native comparison corpus. Every reader now selects a
reviewed language directory inside the same canonical `docs/user-guide/` parent; an omitted locale selects English.
The existing strict file, authored-content and complete-article fallback rules apply to those defaults as well.
The trust decision and release ownership remain unchanged. Original template/route evidence above records its
historical implementation rather than a continuing native frontend requirement.
