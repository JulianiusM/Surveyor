# Activity Requirements and Assignment Recommendations
<!--
documentation-metadata
audience: maintainers; advanced activity-plan contributors
owner: activity-plan maintainers
status: current
last-verified: 2026-09-06
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: D08 requirement precedence, stay-duration generation, live coverage, baseline calculation, recommendation eligibility, fairness, bounded repair, overfill, background jobs, review persistence, and application behavior verified
source-anchors: src/modules/activity/requirements.ts; src/modules/activity/availability.ts; src/modules/activity/fairAssignment.ts; src/modules/activity/autoAssignment.ts; src/modules/activity/recommendations.ts; src/modules/activity/recommendationJobs.ts; src/modules/database/services/ActivityRequirementService.ts; src/modules/database/services/ActivityRecommendationService.ts; src/controller/activityController.ts; src/routes/api/activity.ts; src/public/js/modules/activity/activity-requirements.ts; src/public/js/modules/activity/activity-recommendation-jobs.ts; src/public/js/modules/activity/activity-recommendations-schedule.ts; src/public/js/modules/activity/activity-recommendations-state.ts; src/public/js/modules/activity/activity-recommendations-logic.ts; src/public/js/modules/activity/activity-recommendations-ui.ts; src/views/activity/parts/assignments.pug; src/views/activity/parts/recommendations-schedule.pug; tests/unit/activity-requirements.spec.ts; tests/frontend/activity-requirement-coverage.spec.ts; tests/unit/activity-auto-assignment.spec.ts; tests/unit/activity-recommendation-jobs.spec.ts; tests/integration/activity-workflows.spec.ts
next-review: implementation-change,D14
-->

This is the canonical technical reference for advanced activity-plan requirements, coverage, and assignment recommendations. The in-app [Activity Plans guide](user-guide/ACTIVITY_PLANS.md) explains the organizer workflow and visible controls; this document owns the calculation and persistence semantics so they are not duplicated across user documentation.

The advanced workflow applies only to an activity plan linked to an event. Requirement configuration is protected by **Manage Requirements**. Recommendation generation and review are protected separately by **Manage Assignments**.

## System boundaries

The implementation has four cooperating layers:

1. `requirements.ts` calculates participant requirements, live coverage, hypothetical open-role coverage, and baseline suggestions.
2. `fairAssignment.ts` proposes fair default-role assignments and permitted reassignments.
3. `recommendationJobs.ts` runs generation through a bounded, coalescing job queue and rejects stale results.
4. The controller and recommendation service persist review state, validate operations again, apply approved changes, and preserve rejection and audit history.

The browser imports the same pure requirement module used by the server. Unsaved requirement edits therefore use the same precedence and coverage calculations as persisted settings. The browser preview does not save anything; the organizer must explicitly save the requirement settings.

## Terminology

| Term | Meaning |
|---|---|
| Plan day | One calendar day in the inclusive activity-plan date range. |
| Stay duration | The participant's event attendance window, clamped to the plan date range and counted inclusively. |
| Required shifts | The participant-wide target number of activity-slot assignments. |
| Slot capacity | The slot's `maxAssignees` value. Named roles occupy positions inside this capacity. |
| Role requirement | A participant-wide fixed target selected because the participant currently holds a matching named role somewhere in the plan. |
| Participant override | A fixed target for one registered event participant, optionally restricted to a role that participant currently holds. |
| Recommendation | A staged assignment, reassignment, or unassignment operation with review state. |
| Default-role assignment | A slot assignment without a named role. Automatic generation creates and moves only these assignments. |

## Requirement modes

### Free mode

`FREE` means that no participant minimum is calculated. Participant progress displays **No minimum**, coverage has no active requirement constraint, and automatic recommendation generation is rejected.

The binding deadline and self-assignment policy can still affect ordinary participation, but they do not create recommendation targets in free mode.

### Required mode

`REQUIRED` activates participant targets and automatic recommendations. A valid required-mode configuration must contain exactly one saved non-negative integer requirement for every stay duration from one day through the full plan length.

The server does not invent a missing duration value at runtime. An incomplete table is invalid and automatic recommendation generation is refused.

## Attendance normalization

For requirement calculation, a participant's arrival and departure dates are clamped to the activity plan's inclusive start and end dates. A participant whose attendance does not overlap the plan receives a requirement of zero.

For recommendation eligibility, the allocator also evaluates slot times:

- A slot before arrival or after departure is ineligible.
- An arrival-day slot beginning before noon is never eligible.
- An arrival-day slot beginning at or after noon is eligible only when **Allow arrival-day evening assignments** is enabled.
- A departure-day slot beginning at or after noon is never eligible.
- A departure-day slot beginning before noon is eligible only when **Allow departure-day morning assignments** is enabled.
- A candidate that overlaps another retained, existing, approved, or proposed assignment is ineligible.

When a slot has no parseable start time, the stored arrival-evening or departure-morning classification is used instead.

## Participant requirement precedence

Required mode resolves one exact target per participant. The first applicable rule wins:

1. Among participant overrides whose optional role matches a role currently held by that participant, choose the lowest `requiredShifts` value. An equal-value tie is resolved by the lowest persisted override ID.
2. Otherwise, use the participant-wide override whose role is empty. If more than one exists, the lowest persisted override ID wins.
3. Otherwise, among configured role requirements matching roles currently held by the participant, use the lowest `requiredShifts` value.
4. Otherwise, use the saved stay-duration requirement for the participant's clamped attendance duration.
5. If required mode has no applicable saved duration, the participant is marked unconfigured rather than receiving a rounded fallback.

A value of zero is valid at every level and must not fall through to a lower-priority source.

Role requirements and role-scoped overrides are participant-wide targets. They do not require that many instances of the role, and they are not scaled by stay duration. A role-scoped override applies only while the participant currently holds that role.

## Stay-duration table and rounding

The stay-duration table stores exact integer targets. Rounding is used only while generating proportional values for that table:

```text
value(stayDays) = round(fullStayRequirement × stayDays / planDays)
```

Supported explicit modes are:

- `CEIL` — round upward.
- `ROUND` — round to the nearest integer.
- `FLOOR` — round downward.

A stored null mode corresponds to the visible **None** selection. When proportional values must be generated and no mode is stored, the implementation uses `CEIL` as its default. Once a value is saved in the duration table, that value is used verbatim; participant resolution never rounds it again.

The visible **Baseline shift requirement** is the full-stay input used to generate the duration table. It is useful as an authoring aid and diagnostic value, but the saved duration rows are the runtime source for participants who do not have a higher-priority fixed requirement.

## Baseline calculation

The **Calculate** action proposes an integer full-stay baseline and populates every stay-duration row. It evaluates the currently loaded plan context together with the organizer's current unsaved role requirements and participant overrides.

### Demand target

The target is the sum of every slot's non-negative `maxAssignees` capacity. Named-role quantities are positions within this target rather than additional demand.

### Candidate evaluation

For each candidate baseline, Surveyor:

1. Builds the complete proportional stay-duration table using the selected rounding mode, defaulting to `CEIL` when unset.
2. Resolves each participant through the normal override → role → stay-duration precedence.
3. Applies the hypothetical open-role model described below.
4. Compares the resulting participant requirement total with full slot capacity.

The total is monotonic in the baseline. A bounded binary search finds the first candidate whose requirement total reaches or exceeds capacity. Surveyor compares that candidate with its predecessor and chooses the closer total; the lower baseline wins an equal-distance tie.

The returned diagnostics distinguish:

- Exact coverage.
- An unavoidable integer-rounding gap.
- Fixed role or participant requirements that already fill capacity at baseline zero.
- A plan in which no participant remains whose target can be influenced by the stay-duration baseline.

**Calculate** changes the browser draft only. The organizer may adjust the populated values and must select **Save settings** or **Save requirement settings** to persist them.

## Hypothetical open-role coverage

Coverage needs to estimate the effect of named roles that are configured but not yet held. The exact future role distribution is unknown, so Surveyor computes a constrained global matching.

An open role position is eligible for this model only when:

- Its slot role has remaining quantity.
- The role quantity fits within the slot's overall capacity.
- A candidate participant attends on the slot day.
- The participant currently holds no named role in the plan.
- The participant has no personal override.

The matching obeys these rules:

- One participant may hypothetically fill at most one open named-role position in at most one slot.
- One open position can be matched once.
- The algorithm first maximizes the number of filled open positions.
- Among equally complete matchings, it maximizes the exact amount of participant demand removed from the stay-duration baseline pool.

This model changes coverage totals only. It does not create assignments and does not select named-role holders. Named roles remain an organizer decision.

## Live coverage

The browser recomputes coverage and participant progress from the unsaved draft after every relevant change. The preview displays whether it represents **Saved** settings or **Unsaved changes**, together with **Slot capacity**, **Required shifts**, and, when relevant, modeled or unfillable open-role counts.

The visible states mean:

| State | Meaning |
|---|---|
| **Free assignment mode** | No requirement coverage constraint is active. |
| **Exact coverage** | Total resolved requirements equal total slot capacity. |
| **Above slot capacity by N** | Requirements exceed ordinary capacity, but overfill is enabled. This is allowed, not a guarantee that all targets are reachable. |
| **Short of slot capacity by N** | Overfill is enabled but requirements are below the capacity target. |
| **Hard slot capacity exceeded by N** | Requirements exceed capacity while overfill is disabled. |
| **Below hard slot capacity by N** | Requirements are below capacity while overfill is disabled; unused capacity remains. |
| **Invalid or incomplete requirements** | A duration row is missing or a duration, role, or override value is not a valid non-negative integer. |
| **Role quotas exceed slot capacity** | The named-role quantities configured for at least one slot exceed that slot's overall capacity. |

Coverage is a planning diagnostic, not a proof that a feasible schedule exists. Attendance windows, slot times, overlaps, rejected participant/slot pairs, and named-role commitments can still prevent the allocator from reaching every target.

## Recommendation input context

Generation uses a deterministic snapshot containing:

- The plan mode, dates, rounding setting, overfill policy, and attendance-boundary policies.
- Slots, times, order, capacities, and current assigned counts.
- Registered event participants and their attendance dates.
- Existing assignees and their named-role status.
- Saved stay-duration, role, and participant requirements.
- Existing reviewed recommendation history.

Participants already assigned to the plan and participants named in overrides are merged into the context. Existing role assignments supply the role IDs used by requirement precedence.

Approved assignment recommendations are treated as locked input while replaceable pending work is recalculated. Pending rows are output and therefore excluded from the job fingerprint. Reviewed decisions, including rejections, are input and remain in the fingerprint.

## Automatic allocation

Generation returns only pending `ASSIGN` and `REASSIGN` operations. It never emits `UNASSIGN` and never assigns a named role.

### Eligibility

A participant/slot pair is excluded when:

- The participant is already assigned to that slot.
- It is outside the participant's attendance window.
- It violates the arrival/departure time policy.
- It overlaps another existing, approved, or proposed assignment.
- The participant previously rejected an automatic suggestion for that target slot.

The allocator does not treat ordinary slot capacity as an eligibility warning during its main search; it accounts for capacity through slot counts and the separate overfill phase.

### Fairness and temporal distribution

The allocator repeatedly prioritizes the participant with the lowest fulfilled ratio. It then considers the larger remaining deficit, fewer alternatives, and a stable participant key.

Within those fairness constraints it prefers:

- Slots with fewer eligible participants, preserving constrained capacity.
- Positions near evenly distributed temporal anchors across the participant's attendance window.
- Previously pending participant/slot pairs when otherwise suitable, reducing unnecessary churn.
- Lower boundary penalties and stable chronological order.

Existing and approved assignments count toward the participant's target and influence the next temporal anchor.

### Normal capacity and bounded repair

Surveyor first fills ordinary capacity. It then attempts bounded augmenting repair to fill constrained holes:

- Repair depth is limited to 4.
- The repair search visits at most 2,000 nodes.
- Fairness-improvement ownership swaps are limited to 2,000 moves.
- Pending proposals can be moved when doing so unlocks a better fit.
- A committed existing assignment may be moved only when it has no named role and the vacated source slot can be repaired within the same bounded path.

A moved committed assignment is returned as an explicit `REASSIGN` operation containing both source and target slots. An assignment carrying a named role is never moved automatically.

These limits make the calculation predictable, but they also mean that generation is heuristic rather than an exhaustive proof of optimality. A feasible arrangement can exist beyond the bounded search.

### Last-resort overfill

When **Allow assignments beyond slot capacity** is enabled, overfill runs only after normal-capacity placement and bounded repair are exhausted. Remaining deficits are assigned fairly to eligible full slots while preferring the least-overfilled and best-spaced option.

Overfill does not relax attendance, boundary, overlap, duplicate-assignment, named-role, or rejection constraints. It also does not guarantee that every participant reaches the target when no eligible slot remains.

## Background job lifecycle

Automatic generation is asynchronous.

The coordinator uses these states:

```text
QUEUED → RUNNING → COMPLETE
                 ↘ FAILED
                 ↘ STALE
```

Important behavior:

- At most one active generation job exists for a plan. Repeated requests for that plan coalesce onto the active job.
- Jobs for different plans are processed through the same bounded queue.
- The queue limit is 500 jobs.
- Up to 256 terminal job records and 256 calculated context results are retained.
- Cached results and terminal job records expire after 10 minutes.
- Production builds execute the calculation in a Node.js worker thread. Source-mode development and unit tests use the same function after yielding to the event loop when the compiled worker is absent.
- Before persistence, the coordinator reloads the complete input context and compares its SHA-256 fingerprint with the original snapshot.
- If plan inputs changed during calculation, the result becomes `STALE` and is not written. The organizer must generate again from the new state.
- A matching recent context can reuse a cached deterministic result.

The browser polls the accepted job until it reaches a terminal state, with a maximum polling window of approximately ten minutes.

## Recommendation review model

Visible recommendations have one of three review states:

| State | Review meaning |
|---|---|
| `PENDING` | Generated or retained proposal awaiting an organizer decision. |
| `APPROVED` | Staged for application when **Save changes** is selected. |
| `REJECTED` | Declined proposal; an automatic rejection becomes allocator memory for that participant and target slot. |

`APPLIED` is hidden history rather than a review state shown in the schedule.

The active review UI permits these transitions:

- Pending → Approved.
- Pending → Rejected.
- Approved → Pending.
- Rejected → Approved or Pending.

A newly staged manual operation starts as Approved. Manual operations can be removed before saving. Rejecting a manual operation discards it rather than creating automatic rejection memory.

Automatic rejection memory is target-based: it prevents another generated recommendation for the same participant and target slot. If a calculation already in progress emits that pair, persistence re-exposes it as Rejected instead of Pending. Returning it to Pending or Approved and saving removes that rejection state from future input.

## Manual review operations

From **Add recommendation**, an organizer can stage:

- **New assignment** — assign one participant to the selected target slot.
- **Reassign from another slot** — move one participant from a source slot to the target.
- **Swap two assignments** — stage two reciprocal reassignments.

The organizer can also use **Stage unassignment** beside a confirmed assignment. These operations are review records until **Save changes** is selected.

Reassignment and swap source assignments must be roleless. The review UI filters the available source options, and the server validates the rule again before applying the batch.

## Saving and applying

**Save changes** performs two actions in one request:

1. Persist the submitted review states while retaining hidden applied history and automatic rejection memory that is absent from the visible payload.
2. Apply every submitted Approved operation that remains valid.

Pending and Rejected rows do not alter the schedule.

Before mutation, the server validates that:

- Every source and target slot belongs to the plan.
- Every target profile is an eligible event participant, or an already involved external assignee when external participation is enabled.
- The batch contains no duplicate target and changes each source assignment at most once.
- An assignment being added does not already exist.
- A reassignment or unassignment source still exists.
- A reassignment source has no named role.

It then recomputes attendance, boundary, overlap, and capacity warnings against the complete staged batch. Operations with a blocking warning are skipped. Reciprocal swap legs are treated together: if one leg is blocked, neither leg is applied.

Applied rows become hidden `APPLIED` history. After the binding deadline, a successful application immediately recalculates replaceable pending work against the new committed schedule. Before the deadline, no automatic post-apply regeneration occurs.

When Required mode has a binding deadline in the past and no recommendation history exists, loading the review data can queue the initial generation automatically.

## Persistence rules

Requirement settings are replaced transactionally: plan-level settings, role requirements, participant overrides, and stay-duration rows become one coherent saved revision.

Recommendation persistence follows different rules:

- A generation run deletes and replaces only Pending rows.
- Approved, Rejected, and Applied history survives regeneration.
- A generated rejection is retained as hidden allocation memory after review.
- Applied operations are retained as hidden audit history.
- Manual rejected operations are removed.
- Existing manual or reviewed operations are not silently reclassified as generated work.
- A recommendation already fulfilled by an out-of-band assignment is marked Applied when review data is loaded.
- An obsolete pending reassignment is deleted. An obsolete approved reassignment is marked Rejected instead of being applied against changed source state.

## Known algorithmic limitations

These are properties of the working design rather than transient defects:

- Coverage compares aggregate requirement demand with aggregate slot capacity; it cannot prove a feasible timetable.
- Hypothetical open-role matching affects coverage only and does not choose role holders.
- Automatic generation assigns no named roles.
- Role-bearing committed assignments are immovable by automatic repair.
- Bounded repair can stop before finding a feasible arrangement that requires a deeper or larger search.
- Rejection memory is a participant/target-slot restriction, not a reason-aware or time-limited preference.
- Overfill is optional and last-resort; it cannot bypass attendance or overlap constraints.
- Requirement targets are counts, not preferences for activity type, role, location, or organizer-defined priority.
- The algorithm does not send participant notifications. Organizers must communicate applied schedule changes separately.

## Change checklist

A change to this subsystem should review all of the following together:

1. Requirement persistence and controller validation.
2. Browser draft collection and live coverage.
3. Participant precedence and zero-value behavior.
4. Baseline generation and diagnostics.
5. Hypothetical role matching.
6. Attendance, boundary, and overlap checks.
7. Fair allocation, repair bounds, and overfill.
8. Job fingerprinting, staleness, queueing, and worker execution.
9. Review-state transitions, rejection memory, and hidden history.
10. Batch validation and application atomicity.
11. The in-app advanced organizer workflow.
12. Unit, frontend, integration, and job-coordinator tests.

## Primary code and test references

- Requirement and baseline calculations: `src/modules/activity/requirements.ts`
- Availability and warning rules: `src/modules/activity/availability.ts`
- Fair recommendation algorithm: `src/modules/activity/fairAssignment.ts`
- Context assembly: `src/modules/activity/autoAssignment.ts`
- Batch warning calculation: `src/modules/activity/recommendations.ts`
- Job coordination: `src/modules/activity/recommendationJobs.ts`
- Requirement persistence: `src/modules/database/services/ActivityRequirementService.ts`
- Recommendation persistence: `src/modules/database/services/ActivityRecommendationService.ts`
- Controller orchestration: `src/controller/activityController.ts`
- Browser requirement workflow: `src/public/js/modules/activity/activity-requirements.ts`
- Browser recommendation workflow: `src/public/js/modules/activity/activity-recommendations-schedule.ts`
- Requirement tests: `tests/unit/activity-requirements.spec.ts` and `tests/frontend/activity-requirement-coverage.spec.ts`
- Allocator and job tests: `tests/unit/activity-auto-assignment.spec.ts` and `tests/unit/activity-recommendation-jobs.spec.ts`
- End-to-end service/controller contracts: `tests/integration/activity-workflows.spec.ts`
