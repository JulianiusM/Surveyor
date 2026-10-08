# In-App Help Visuals

<!--
documentation-metadata
audience: documentation contributors; feature maintainers
owner: product documentation maintainers
status: current
last-verified: 2026-10-08
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: FPR-07 native production visual guidance preserved; explicit all-language implementation-information prohibition; English/German native navigation re-rendered and inspected individually at original/768px/298px widths and header crop; unchanged diagrams and retained controls reference
source-anchors: docs/user-guide/assets/; docs/user-guide/README.md; docs/user-guide/SURVEYS.md; docs/user-guide/PACKING_LISTS.md; src/views/layout.pug; src/views/surveyor/survey-vote.pug; src/views/packing/packing-view.pug; .github/workflows/release.yml; tests/unit/help-documentation.spec.ts
next-review: help-visual-or-visible-UI-change
production-reference: 2dfa257 native frontend documentation; reference only, not installed production evidence
-->

The images under `docs/user-guide/assets/` are maintained instructional visuals. The navigation image combines a **source-rendered screenshot of the actual application header** with numbered explanations placed outside that screenshot. It preserves the original logo, Home link, New and Overview menus, Help link and profile area. The example profile is fictional; this is not a capture of a live production account.

The other three images are explicitly captioned explanatory diagrams, not screenshots. Their labels and state distinctions must match the application. The survey example uses the visible option **1. day in month**, rather than inventing a replacement label.

Assets retain their existing filenames. Each displayed image's adjacent caption includes a full-size image link through the existing help-asset route. Small previews do not replace the written procedures or the ability to inspect the full-size image.

The controls illustration is retained as an authoring reference while its entity-settings update is tracked in the
remediation backlog. It is not embedded in the current user guide; written guidance provides the current controls.

## Ownership

The product documentation maintainers own the asset set. A feature maintainer identifies affected visuals and guides when labels or control relationships change, then updates them or records follow-up work without blocking feature delivery. Every visual that is actually changed still requires individual inspection after each revision.

| Asset | Used by | Implementation sources to compare |
|---|---|---|
| `navigation-at-a-glance.png` | User-guide home | `src/views/layout.pug`, `src/views/users/dashboard.pug` |
| `participant-and-organizer-controls.png` | Retained authoring reference; refresh tracked as DOC-ENTITY-PROPERTIES-VISUAL | `src/views/modules/module_entity_properties.pug`, feature views, permission metadata |
| `survey-recurring-pattern.png` | Surveys | `src/views/surveyor/survey-create.pug`, `src/views/surveyor/survey-vote.pug` |
| `packing-shared-vs-local.png` | Packing Lists | `src/views/packing/packing-create.pug`, `src/views/packing/packing-view.pug`, `src/public/js/packing.ts` |

## Authoring rules

- Keep visuals task-focused. Show only the labels and relationships needed to recognize the relevant screen or state.
- Implementation information is strictly forbidden in user-facing prose, captions, alt text and picture pixels
  in every language. Keep framework names, rendering/generation details, source paths and internal identifiers
  in maintainer documentation or ignored evidence. Follow the [user-facing content boundary](DOCUMENTATION_POLICY.md#user-facing-content-boundary).
- Each available language owns its guide text, captions and assets. Keep equivalent localized figures self-contained
  and inspect them independently; do not silently borrow another language's picture.
- Use a non-empty Markdown alt description that communicates the instructional point without requiring the image.
- Add a nearby caption when the image is an abstraction, when local versus shared state matters, or when a permission boundary needs clarification.
- Store release-managed raster files under `docs/user-guide/assets/`. Do not embed remote images, data URIs, active SVG, scripts, or HTML.
- Do not place personal data, real invitation tokens, credentials, production hostnames, or real participant names in a visual.
- Treat all text inside the image as documentation: verify spelling, capitalization, and meaning against the current Pug or browser source.

## Mandatory visual inspection

Inspect **each image separately after every change**. A contact sheet, successful generation command, bounding-box assertion or earlier revision does not constitute acceptance of the changed image. Open the exact PNG that will be committed, not just an editor preview.

Check the complete image at full resolution, at a representative in-app width, and at a narrow-screen width. Read every title, label, sentence and caption. Check panel boundaries, wrapping, margins, arrows, badges and table columns for text collisions, clipping, overflow or ambiguous associations. Check the real-header crop independently: it must retain the original branding, labels, ordering and account state, without annotation drawn over the controls.

Use measured text widths and explicit padded content boxes when annotating. Prefer shorter copy, more space, additional lines or a taller panel to shrinking text until it fits. Automated containment and overlap checks supplement, but never replace, the visual inspection.

## Update procedure

1. Identify the affected guide, source templates and browser modules. Capture navigation from the actual header; do not draw a substitute navbar from memory. An offline source-rendered fixture must preserve the template's markup and styling, use fictional account data. Record its origin and source/asset fingerprints only in maintainer documentation or ignored authoring evidence, never in user-facing text or pixels.
2. Update only the affected visual, retaining its filename when its purpose is unchanged. Keep annotations away from screenshot controls and clearly distinguish diagrams from screenshots.
3. Open and inspect that individual exported image at full resolution and representative reduced sizes. Any subsequent change invalidates its prior acceptance: regenerate and inspect it again. Repeat until there are no visual defects in the final export.
4. Recheck alt text, captions and the full-size link. On narrow screens, confirm that the image fits the page and readers can open it at full resolution. Keep the procedure understandable without the image.
5. Optionally collect the documentation reports and content checks in the [Testing Guide](TESTING_GUIDE.md). Record actual findings and execution limits; an advisory exit zero is not proof of visual correctness. These checks never block application delivery. Individual visual inspection remains the authoring practice after every image change.
6. Confirm that the release bundle contains every referenced asset. Record the final image hash, dimensions, inspection sizes, findings and acceptance result. Inspect the packaged PNG again if packaging changes its bytes.

Removing a visual requires removing its Markdown reference and either deleting the unreferenced asset or documenting why it remains. Any proposal to load visuals from an untrusted or remotely managed source must reopen [DEC-004](decisions/DEC-004-HELP-MARKDOWN-TRUST-MODEL.md) before implementation.

## Native production and prospective navigation

This guide describes the native header from `src/views/layout.pug`. Frontend-specific navigation guidance,
localized header figures and authoring commands are staged in the [temporary replacement](frontend-migration/staged/HELP_VISUALS.md),
not introduced as native production features. The other feature guides and their procedures are unchanged.

The corrected English navigation asset was rendered from the canonical native Pug layout using fictional account
data and the existing figure authoring composition. The obsolete public implementation/provenance footer was
omitted. No product labels or task relationships changed. The exported PNG is 1440 × 1065; SHA-256 is
`5fd0951c7fdec6555c7ed534594f77e328f8d442ea31d8331a874f86f9bbd727`.
The exact export, its separate 768px and 298px previews and its 1344px header crop were opened individually.
There is no clipping, collision or annotation over a control. The narrow preview retains the full-size link
and written procedures for small text. The source-only authoring adaptation and fingerprints remain in ignored
`.temp/frontend-docs-rectification/` evidence; no new illustration subsystem or production dependency is added.

The previously accepted prospective English/German navigation bytes and their 2026-10-07 provenance remain in
the staged visual guide. Historical baseline fingerprints are not rewritten, and an advisory hash mismatch
against an older reference does not invalidate the retained source history.

The German navigation image uses the same actual native Pug header and German explanatory text; exact native
menu labels remain English because native navigation does not translate them. The translated future header and
its matching original German caption remain staged. The German PNG is 1440 × 1065; SHA-256 is
`e0ef548a08fd7222d42adecfbefee65dd27664ef513a20d3b66e91b3ec22ae30`.
Its exact export, 768px/298px previews and header crop were opened separately with no clipping, collision or
annotation over controls. Only the German home image description/caption and hidden provenance were aligned;
other feature guide tasks are unchanged.
