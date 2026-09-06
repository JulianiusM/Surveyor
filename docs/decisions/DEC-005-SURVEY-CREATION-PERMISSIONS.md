# DEC-005: Surveys and the General Permission System

<!--
documentation-metadata
audience: maintainers; documentation contributors
owner: survey-feature and permission-system maintainers
status: current
last-verified: 2026-09-05
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: maintainer-confirmed-product-contract-and-static-behavior
source-anchors: src/routes/survey.ts; src/controller/surveyController.ts; src/views/surveyor/survey-create.pug; src/middleware/guestFlowFactory.ts; src/modules/lib/permissions.ts; docs/documentation-remediation.yml
next-review: D03
-->

## Decision status

**Resolved: surveys deliberately do not implement the general permission system used by the other primary entity types.**

The absence of a **Group Permissions** matrix from survey creation is intentional. The survey creation controller also
intentionally does not persist the standard audience permission values. These are feature boundaries, not transient
implementation defects.

This record changes documentation state only. It does not modify the survey implementation, tests, or in-app help.

## Evidence and intent

The survey feature follows its own participation and access flow:

- `src/views/surveyor/survey-create.pug` contains the survey fields and date-combination controls, but no permission matrix.
- `src/controller/surveyController.ts` creates the survey and combinations without saving general audience permissions.
- `src/routes/survey.ts` exposes survey-specific participation actions such as voting and adding combinations.
- The shared creation router may provide permission-related view metadata, but a feature participates in the permission
  system only when its view, controller, routes, and persistence model consume that capability.

Shared plumbing and similarity to other entity types do not establish a requirement that every feature use the same
permission model. Maintainer-confirmed product intent resolves the apparent cross-feature inconsistency: surveys are an
intentional exception.

## Documentation contract

### D03 — Permission model and sharing recipes

D03 must define the scope of the general permission system accurately:

- Do not state that it controls surveys.
- Do not state that every entity creation form displays a **Group Permissions** matrix.
- Do not use a survey as an example for audience masks, individual administrators, presets, or item inheritance.
- Include a concise, prominent note that surveys use a separate feature-specific access and participation flow.
- Refer readers to the survey guide for survey behavior rather than attempting to map survey actions to permission bits.

### D09 — Surveys

D09 must document the survey feature as implemented:

- Do not add a permission-selection step to survey creation.
- Do not tell organizers to configure public, guest, authenticated, or participant permission masks for a survey.
- Replace the current generic permission claims with the actual survey-specific sharing, guest, ownership, and
  participation behavior after those paths are verified in D09.
- Keep authorization for adding combinations separate; that behavior remains the subject of `DEC-001`.

The stable survey exception belongs in product documentation because it is intentional behavior. Temporary defects in
other areas remain confined to migration-control records under the documentation policy.

## Gate effect

`DEC-005` no longer blocks D03 or D09. D03 is ready but remains held until the decision wave is complete. D09 remains
blocked by D01, D03, and `DEC-001`.

This decision is reopened only if surveys intentionally adopt the general permission system or their feature-specific
access model is redesigned.
