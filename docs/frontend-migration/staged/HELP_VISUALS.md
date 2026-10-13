# Staged frontend Help visuals amendment
<!--
documentation-metadata
audience: documentation contributors; feature maintainers
owner: product documentation maintainers
status: migration-pending
last-verified: 2026-10-13
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: approved release-owned pilot corpus and bounded native-asset cleanup reconciled; historical export inspection retained; no new generation or final visual acceptance claimed
source-anchors: scripts/generate-help-visuals.mjs; src/locales/; docs/user-guide/en/; docs/user-guide/de/; src/frontend/components/AppHeader.vue; src/views/surveyor/survey-vote.pug; src/frontend/features/packing/; docs/features/help/HELP_VISUALS.md
next-review: frontend-production-cutover
canonical-merge-target: docs/features/help/HELP_VISUALS.md
production-reference: 2dfa257 native documentation; not evidence of installed production
-->

## Cutover staging

This maintainer amendment describes the approved pilot Help asset owner. At authorized cutover, reconcile
[Help Visuals](../../features/help/HELP_VISUALS.md), merge applicable sections and remove this copy.
Native guide prose/images remain the comparator; editorial cleanup of their maintenance records is authorized.

Pilot runtime assets live beside reviewed articles under `docs/user-guide/en/assets/` and
`docs/user-guide/de/assets/`. Staged documents are not runtime sources.
Promotion preserves existing image bytes; it is not new generation or visual acceptance.

## Asset and label ownership

Prefer complete equivalent localized images, captions, non-empty alt text and full-size links.
Each available `visual-labels.json` owns diagram copy; actual UI text comes from the shared catalog.
The explicit Oct13 Req. 2B amendment replaces the earlier individual-figure fallback: a missing required localized
figure selects the entire reviewed English article with all its own English assets and visible fallback disclosure.
Translated article text never borrows English images. Asset URLs identify the article's actual source language and
asset requests never independently choose another corpus. Existing invalid source still fails its normal checks.

| Asset in each language | Task and source to compare |
|---|---|
| `navigation-at-a-glance.png` | Real localized Vue header; AppHeader/navigation components and selected catalog. |
| `survey-recurring-pattern.png` | Recurring choices; existing native survey control and deliberate labels. |
| `packing-shared-vs-local.png` | Shared assignment versus browser-local Packed? checklist; Packing controls/catalog. |

Navigation combines a source-rendered real header with numbered explanations outside the crop and fictional account
data. Do not redraw/relabel a remembered navbar. Other pictures are captioned explanatory diagrams.
The explicitly approved 2026-10-12 cleanup removed the unused obsolete native controls illustration, as recorded in
the [foundation ledger](../FRONTEND_FOUNDATION_DESIGN.md#explicit-canonical-location-and-action-decisions-2026-10-12).
The remaining native images stay unchanged; that bounded exception grants no further asset removal or redesign.

## Authoring and individual inspection

- Show tasks, exact visible labels and observable relationships only. Framework/API/storage/permission/source/
  generation/provenance information is forbidden in user prose, alt text, captions and pixels.
- Keep provenance in maintainer/ignored evidence; required hidden metadata must not become rendered content.
- Use reviewed raster files in each language's assets directory; no remote images, data URI, active SVG or raw HTML.
- Never include real participant data, tokens, credentials or production hosts.
- Keep filenames stable for unchanged purposes, adjacent full-size links and understandable written procedures.

Every changed export requires separate inspection of the exact final file at original resolution, representative
article width and a narrow screen. Read titles, labels/captions; check wrapping, edges, margins, arrows, badges,
columns, clipping/collisions and associations. Inspect the real-header crop independently.
A contact sheet, generator success, older acceptance or automated bounding boxes cannot accept changed pixels.

Measure text and use padded boxes. Prefer shorter copy/more room/lines to unreadably shrinking type.
Any further revision invalidates prior acceptance. Reinspect if packaging changes image bytes.

## Update procedure

1. Identify affected guide/control labels and capture the actual localized source header where necessary.
2. Update affected figure/labels only, with annotations outside controls and diagrams distinct from screenshots.
3. Inspect each final file separately at full/reduced sizes; repeat after every change.
4. Verify alt/caption/full-size URL, narrow-page containment and the written task without relying on pixels.
5. Confirm reviewed release packaging. Record hashes/dimensions/inspection sizes/findings in maintainer/ignored
   evidence. Optional reports remain advisory rather than delivery gates.

Keep removed pilot references/assets coherent; native assets remain frozen.
An untrusted/tenant/editor/remote source requires reopening [DEC-004](../../decisions/DEC-004-HELP-MARKDOWN-TRUST-MODEL.md).

## Reproducing localized figures

After the normal application build, the existing script selects the approved runtime locale corpus:

```powershell
node scripts/generate-help-visuals.mjs --locale=en --figure=navigation
node scripts/generate-help-visuals.mjs --locale=de --figure=navigation
```

`--figure` limits exports; omitting it regenerates all three and requires inspecting every changed image.
Labels/output are fixed under `docs/user-guide/<locale>/`; no flag targets native Help or staging.
The script uses the built Vue renderer, fictional session and pinned styling without a database/application server.
Ignored `.temp/help-visuals-<locale>/` contains fingerprints/previews, not another runtime dependency.

## Historical inspection (2026-10-07)

Earlier EN/DE exports were inspected individually at 1440px, 768px and 298px article width; header crops separately.
Navigation revisions removed public implementation/provenance footnotes. Reported labels were readable without
clipping/collisions; full-size links remained for small text. The following hashes preserve that original evidence
under the promoted paths; they do not certify current application screenshots or future regenerated images.

| Asset | Dimensions | SHA-256 |
|---|---|---|
| `en/assets/navigation-at-a-glance.png` | 1440 × 1065 | `266d30271e4ca6b621908760072e6d138500a9c50011f99c44e80434c913ecd3` |
| `de/assets/navigation-at-a-glance.png` | 1440 × 1065 | `dcaf7025b257ae8d81e67d6a399b92e30a52c1e2b01d92d68405af960412d3f0` |
| `de/assets/survey-recurring-pattern.png` | 1440 × 1252 | `f58bcdda6fea37a5a553a1f780fbb82aa51de124dfe03cdf42d2a5101fa019ac` |
| `de/assets/packing-shared-vs-local.png` | 1440 × 1179 | `43b23feb28971b43ec4499df71a93b73e8fa68d630b6a8cff607db3780950f84` |

Promotion preserves those bytes. Final source/runtime/visual checks belong to the
[pilot review](../PILOT_PARITY_REVIEW.md); no new generation or production cutover is claimed here.
