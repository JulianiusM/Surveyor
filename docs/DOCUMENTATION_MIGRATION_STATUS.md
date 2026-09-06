# Documentation Migration Status
<!--
documentation-metadata
audience: documentation maintainers; feature maintainers; operators; AI agents
owner: documentation maintainers
status: current
last-verified: 2026-09-06
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: D00-D14 documentation migration complete; D04V retained as a non-blocking controlled operator-runbook verification backlog; D14 visual correction, per-asset inspection and actual inherited gate outcomes
source-anchors: docs/documentation-remediation.yml; docs/DOCUMENTATION_POLICY.md; docs/ACTIVITY_REQUIREMENTS_ALGORITHM.md; docs/user-guide/ACTIVITY_PLANS.md; docs/user-guide/README.md; docs/ARCHITECTURE.md; src/modules/activity/requirements.ts; src/modules/activity/availability.ts; src/modules/activity/fairAssignment.ts; src/modules/activity/autoAssignment.ts; src/modules/activity/recommendations.ts; src/modules/activity/recommendationJobs.ts; src/modules/database/services/ActivityRequirementService.ts; src/modules/database/services/ActivityRecommendationService.ts; src/controller/activityController.ts; src/public/js/modules/activity/; src/views/activity/parts/assignments.pug; src/views/activity/parts/recommendations-schedule.pug; scripts/check-help-documentation.mjs; tests/unit/help-documentation.spec.ts; tests/e2e/help-experience.spec.ts; .github/workflows/release.yml
next-review: D04V-or-implementation-defect-remediation
-->

This file is the human-readable continuation point for the incremental documentation migration. The complete findings,
dependencies, implementation-defect register, acceptance criteria, and run history are maintained in
[`docs/documentation-remediation.yml`](documentation-remediation.yml).

## Current state

**D14 visual correction is complete.** The four existing illustrations have been replaced and individually inspected at full resolution and at 720-pixel and 360-pixel preview widths. The navigation illustration now embeds a source-rendered capture of the actual header, with fictional profile data, instead of a hand-drawn substitute. Measured text blocks have no overlaps or overflow. The narrow previews have adjacent full-size image links for inspection of fine detail.

The detailed correction record, final image hashes and outstanding validation follow-up are under `d14_visual_correction` in [the remediation backlog](documentation-remediation.yml). The ongoing capture and mandatory per-revision inspection rules are in [Help Visuals](HELP_VISUALS.md).

Only documentation, four PNG assets and migration records changed in this correction. Application source, tests, scripts, package files and workflows are byte-for-byte unchanged from the supplied Phase 3N archive. Its observed implementation fingerprint is unchanged by this correction:

```text
sha256:a76d9becfadde3d81765115a22202f1de02fe6f9bfed794559e559ded8e206bf
```

**Validation qualification:** the structural and help-authoring gates already fail in the supplied Phase 3N archive, and still fail after this image-only change. Their failures are recorded centrally as `D14-VAL-001` and `D14-VAL-002`; the earlier blanket passing-gate claims are not reaffirmed. The malformed placement of duplicate completion fields in the backlog has been corrected so the updated YAML can be read.

D04V remains a separate, non-blocking operational rehearsal. No implementation defect was repaired in this correction. The following D08 and D14 sections preserve historical delivery context; their verification claims describe prior runs, not results reproduced by this visual correction.

## D08 delivered contracts

### Requirements and precedence

The in-app guide now explains the visible **Configure rules & defaults** workflow, including:

- **Free** and **Required** assignment modes.
- The complete **Stay duration requirements** table.
- **Baseline shift requirement**, **Calculate**, and explicit rounding behavior.
- **Role requirements** as participant-wide targets.
- Registered-event-participant **Participant overrides**.
- The exact role-scoped override → participant-wide override → role requirement → stay-duration precedence.
- Zero as a valid requirement at every level.
- Saving and reloading behavior for requirement drafts.

### Live coverage

The guide explains every visible coverage state and distinguishes aggregate planning from timetable feasibility. It covers
**Saved** and **Unsaved changes**, **Slot capacity**, **Required shifts**, open-role modeling, incomplete configuration,
role-capacity conflicts, ordinary capacity, and permitted overfill.

Hypothetical open-role matching is described as a coverage estimate only. It does not assign a participant or fill a
named role.

### Automatic assignment suggestions

The advanced workflow now documents:

- Required-mode prerequisites and persisted-input requirements.
- **Auto-generate** and asynchronous generation.
- Stale calculations when the plan changes during a job.
- Fair progress toward participant targets and temporal distribution.
- Ordinary assignments only; named roles remain manual.
- Roleless reassignment, protection of role-bearing assignments, bounded repair, and last-resort overfill.
- The fact that a bounded heuristic can miss a feasible arrangement.

### Review and application

The guide maps the complete review workflow:

- **Pending**, **Approved**, **Rejected**, and **Confirmed**.
- **Approve**, **Reject**, and **Revert to Pending**.
- Rejection memory for an automatically generated participant/slot pair.
- **Add recommendation**, **New assignment**, **Reassign from another slot**, and **Swap two assignments**.
- **Stage unassignment** and **Stage as approved**.
- **Save changes**, server-side batch revalidation, skipped blocked operations, reciprocal swap behavior, hidden applied
  history, and post-deadline regeneration.

### Canonical technical reference

[`docs/ACTIVITY_REQUIREMENTS_ALGORITHM.md`](ACTIVITY_REQUIREMENTS_ALGORITHM.md) is now the single technical reference for:

- Requirement and attendance normalization.
- Stay-duration generation and baseline calculation.
- Hypothetical role coverage.
- Fair allocation and temporal distribution.
- Bounded repair and overfill.
- Queue limits, caching, context fingerprints, and stale jobs.
- Recommendation state transitions, rejection memory, manual operations, batch validation, and persistence.
- Stable algorithmic limitations and the maintainer change checklist.

The in-app guide deliberately omits queue sizes, repair constants, fingerprint composition, and persistence internals so
advanced user detail does not interrupt novice tasks or create a second technical specification.

## Centrally recorded implementation defects

Static review identified two isolated recommendation-interface defects. They are recorded only in the migration
controls; product documentation describes the coherent working contract assuming they have been corrected.

| Defect | Central record |
|---|---|
| `IMP-029` | The active schedule review stores server warnings and receives skipped-operation results but does not currently render them to the organizer. |
| `IMP-030` | The active schedule review does not currently observe and poll the initial recommendation job queued automatically after a past binding deadline. |

No workaround or transient warning was copied into the user guide, architecture, algorithm reference, operator
material, or AI instructions.

## Finding closed in D08

| Finding | Resolution |
|---|---|
| `ACT-003` | Participant and first-use organizer tasks remain first; the advanced workflow is task-oriented; implementation internals are maintained in one canonical technical reference. |

## Changed repository paths

Exactly seven documentation paths changed:

```text
docs/ACTIVITY_REQUIREMENTS_ALGORITHM.md
docs/ARCHITECTURE.md
docs/DOCUMENTATION_MIGRATION_STATUS.md
docs/README.md
docs/documentation-remediation.yml
docs/user-guide/ACTIVITY_PLANS.md
docs/user-guide/README.md
```

No path changed under:

```text
src/
tests/
scripts/
.github/
```

No package, lockfile, environment example, generated output, build, workflow, configuration, or runtime implementation
file changed.

## Verification record

D08 verification establishes that:

- The package-specific semantic and source-contract checker passes **374 of 374** recorded assertions.
- Every advanced visible label used by the user workflow exists in the activity templates or active browser modules.
- Requirement precedence, valid zero values, duration completeness, coverage states, baseline generation, role modeling,
  recommendation eligibility, repair limits, overfill, job lifecycle, review transitions, rejection memory, manual
  operations, batch validation, and persistence statements trace to the listed source anchors.
- The documentation checker reports no broken relative links, missing metadata, undefined `npm run` commands, missing
  repository paths, stale concepts, or deferred debt.
- Both normal and strict documentation gates pass.
- Applying the D08 patch to a fresh Phase 3L tree reproduces the implemented tree exactly.
- The complete repository archives and changed-document bundle reproduce the same files and checksums.

No application build or runtime test suite was required because D08 changes only documentation. No runtime execution
result is claimed.

## Outstanding independent work

- **D14** is now ready. Every behavior-documentation dependency is complete.
- **D04V** remains the non-blocking controlled verification of the accepted operator runbook.
- Runtime implementation defects remain centralized in the remediation backlog and require separately authorized source
  changes.


## Phase 3N — D14 in-app help UX and validation

**Status: complete.** D14 closes the final documentation-migration package.

Verification baseline: `docs-baseline-2026-09-06-d14` (`sha256:e4b39f0aa6e98e3645db4e02ee703b6be5c68aaa251dbf51107677b4dae28e95`).

Implemented boundaries:

- Task-grouped help navigation, server-side search, contextual navbar links, and per-page tables of contents.
- Four maintained interface maps with explicit ownership, source mapping, alt-text, and update rules.
- A fixed `docs/user-guide/` Markdown source and fixed `docs/user-guide/assets/` image source with containment checks.
- Rejection of active raw HTML, unsafe URI schemes, protocol-relative URLs, remote images, unsupported image types, missing alt text, missing assets, and unreferenced assets while permitting the documentation metadata comment.
- Rendered semantic tests for onboarding, overview, permissions, recurring surveys, packing state and counters, advanced activity recommendations, and drivers-list counters.
- Focused Playwright coverage for search, tables of contents, visuals, and contextual help entry.
- Release verification that the complete user-guide tree is packaged byte-for-byte.

D14 closes `HELP-001`, `HELP-002`, `HELP-003`, and `HELP-004`. No unrelated feature behavior was changed and no new runtime feature defect was registered.

The documentation migration from D00 through D14 is now complete. `D04V` remains a separately executable, non-blocking verification backlog for rehearsing the accepted operator runbook. Centrally recorded implementation defects remain outside documentation migration and require separately authorized source changes.

## Exact continuation point

The next bounded run is **D04V only — controlled operator-runbook verification**. Execute one `OPSV-*` item at a time in an isolated environment and attach the required evidence before marking that item complete. The recommended first item is `OPSV-001`: install an official release archive, start it through the documented service model, and verify `/healthz`.

Do not combine D04V with application-feature repairs. When execution disproves the accepted operating contract, record one implementation defect, keep it centralized, and update an operator document only when the observed working setup requires a durable correction.

The alternative continuation is a separately authorized implementation-defect remediation package selected from `IMP-001` through `IMP-030`; such a package is outside this documentation-only migration.
