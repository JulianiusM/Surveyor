# In-App Help Visuals

<!--
documentation-metadata
audience: documentation contributors; feature maintainers
owner: product documentation maintainers
status: current
last-verified: 2026-10-25
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: P11 retained component/catalog/asset ownership reconciled after native comparison retirement; authoring rules unchanged; no image regeneration or fresh visual acceptance claimed
source-anchors: docs/user-guide/en/; docs/user-guide/de/; src/frontend/components/AppHeader.vue; src/frontend/features/packing/; src/frontend/features/surveys/; src/locales/; scripts/generate-help-visuals.mjs; .github/workflows/release.yml; tests/unit/help-documentation.spec.ts
next-review: help-visual-or-visible-UI-change
-->

Reviewed images in each Help corpus's `assets/` directory under `docs/user-guide/` are maintained instructional visuals.
The navigation image combines a **source-rendered screenshot of the actual application header** with numbered
explanations placed outside that screenshot. Use the actual logo, navigation, Help link and account/profile area for
the article's corpus. The example profile is fictional; this is not a capture of a live production account.

The other two images are explicitly captioned explanatory diagrams, not screenshots. Their labels and state
distinctions must match the application in the article's selected language. The survey example takes its first
weekday occurrence and answer labels from the same catalog as the visible add-combination controls, rather than
copying an English label into another language or inventing a replacement label.

Assets retain their existing filenames. Each displayed image's adjacent caption includes a full-size image link through the existing help-asset route. Small previews do not replace the written procedures or the ability to inspect the full-size image.

## Ownership

The product documentation maintainers own the asset set. A feature maintainer identifies affected visuals and guides when labels or control relationships change, then updates them or records follow-up work without blocking feature delivery. Every visual that is actually changed still requires individual inspection after each revision.

| Asset | Used by | Implementation sources to compare |
|---|---|---|
| `navigation-at-a-glance.png` | User-guide home | The article's actual rendered header from `src/frontend/components/AppHeader.vue`. |
| `survey-recurring-pattern.png` | Surveys | The article's actual combination/answer controls: `src/frontend/features/surveys/CombinationFields.vue`, `src/frontend/features/surveys/SurveyPage.vue` and `src/locales/`. |
| `packing-shared-vs-local.png` | Packing Lists | The article's actual shared-assignment and browser-local Packed controls; the shared owner is `src/frontend/features/packing/`. |

## Authoring rules

- Keep visuals task-focused. Show only the labels and relationships needed to recognize the relevant screen or state.
- Apply the [user-facing content boundary](../../policies/DOCUMENTATION_POLICY.md#user-facing-content-boundary) to picture pixels,
  captions and alt text in every language; retain source/generation/provenance information only in maintainer evidence.
- Use a non-empty Markdown alt description that communicates the instructional point without requiring the image.
- Add a nearby caption when the image is an abstraction, when local versus shared state matters, or when a permission boundary needs clarification.
- Store release-managed raster files directly under the reviewed article corpus's `assets/` directory within
  `docs/user-guide/`. Do not embed remote images, data URIs, SVG, scripts, or HTML.
- Do not place personal data, real invitation tokens, credentials, production hostnames, or real participant names in a visual.
- Treat all text inside the image as documentation: verify spelling, capitalization, and meaning against the article's
  actual rendered controls and reviewed language labels. Use shared catalog text where it owns those controls.

## Language-owned images

Each available `visual-labels.json` supplies its diagram copy; actual localized UI text comes from the shared catalog.
The maintained generator's bounded Survey aliases bind the real add-combination heading, weekday, first occurrence,
action and answer labels. Language-owned files contain explanatory copy and sample choices, not a second UI catalog.
Review equivalent localized captions, non-empty alt descriptions and full-size links with each image. Asset URLs
identify the article's actual language, and authored local references stay within that article's corpus.

If a required localized figure is missing, the [Help policy](../../policies/DOCUMENTATION_POLICY.md#localized-help)
selects the complete reviewed English article with all its own English assets and a visible disclosure. Translated
article text never borrows an English figure. Asset requests cannot independently choose another corpus, and invalid
existing source fails its normal checks.

## Mandatory visual inspection

Inspect **each image separately after every change**. A contact sheet, successful generation command, bounding-box assertion or earlier revision does not constitute acceptance of the changed image. Open the exact PNG that will be committed, not just an editor preview.

Check the complete image at full resolution, at a representative in-app width, and at a narrow-screen width. Read every title, label, sentence and caption. Check panel boundaries, wrapping, margins, arrows, badges and table columns for text collisions, clipping, overflow or ambiguous associations. Check the real-header crop independently: it must retain the original branding, labels, ordering and account state, without annotation drawn over the controls.

Use measured text widths and explicit padded content boxes when annotating. Prefer shorter copy, more space, additional lines or a taller panel to shrinking text until it fits. Automated containment and overlap checks supplement, but never replace, the visual inspection.

## Update procedure

1. Identify the affected guide, source templates/components, browser modules and language labels. Capture navigation from the actual header; do not draw a substitute navbar from memory. An offline source-rendered fixture must preserve its actual markup and styling and use fictional account data. Record its origin and source/asset fingerprints in maintainer documentation or ignored authoring evidence, away from user-facing text and pixels.
2. Update only the affected visual, retaining its filename when its purpose is unchanged. Keep annotations away from screenshot controls and clearly distinguish diagrams from screenshots.
3. Open and inspect that individual exported image at full resolution and representative reduced sizes. Any subsequent change invalidates its prior acceptance: regenerate and inspect it again. Repeat until there are no visual defects in the final export.
4. Recheck alt text, captions and the full-size link. On narrow screens, confirm that the image fits the page and readers can open it at full resolution. Keep the procedure understandable without the image.
5. Optionally collect the documentation reports and content checks in the [Testing Guide](../../TESTING_GUIDE.md). Record actual findings and execution limits; an advisory exit zero is not proof of visual correctness. These checks never block application delivery. Individual visual inspection remains the authoring practice after every image change.
6. Confirm that the release bundle contains every referenced asset. Record the final image hash, dimensions, inspection sizes, findings and acceptance result. Inspect the packaged PNG again if packaging changes its bytes.

Removing a visual requires removing its Markdown reference and either deleting the unreferenced asset or documenting why it remains. Any proposal to load visuals from an untrusted or remotely managed source must reopen [DEC-004](../../decisions/DEC-004-HELP-MARKDOWN-TRUST-MODEL.md) before implementation.

## Reproducing localized figures

After the normal application build, the maintained script exports figures for the selected reviewed locale corpus:

```powershell
node scripts/generate-help-visuals.mjs --locale=en --figure=navigation
node scripts/generate-help-visuals.mjs --locale=de --figure=navigation
```

`--figure` limits exports; omitting it regenerates all three and requires inspecting every changed image.
Labels and output are fixed under the catalog-selected `docs/user-guide/<locale>/` directory. Requests and flags do
not select arbitrary source or output roots. This script uses the built Vue renderer, fictional account data and
the built Vite styling without a database or application server.
Ignored `.temp/help-visuals-<locale>/` fingerprints/previews are authoring evidence, not runtime dependencies.
