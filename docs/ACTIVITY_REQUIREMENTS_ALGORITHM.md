# Activity shift requirement algorithm

Surveyor uses the same calculation module for saved backend results, the live requirements preview, baseline suggestions, and recommendation targets. This keeps unsaved frontend input and persisted plans semantically identical.

## Participant requirements

Required mode resolves each participant in this strict order:

1. A matching participant-specific override is used verbatim.
2. Otherwise, the minimum configured requirement among the participant's assigned roles is used verbatim.
3. Otherwise, the saved requirement for the participant's clamped attendance duration is used verbatim.

Free mode has no requirements and bypasses automatic recommendation work.

Rounding occurs only when a proportional stay-duration table is initially generated. Resolving a participant never rounds an override, role requirement, or saved stay-duration value.

## Capacity and hypothetical open roles

Demand is the sum of every slot's full `maxAssignees` capacity. Named role quantities are positions within that capacity, not additional capacity.

The preview assumes that fillable open named roles will eventually be held by participants. Since the exact role distribution is unpredictable, it computes a worst-case matching with these rules:

- only participants who currently have no role and no personal override may take a hypothetical role;
- one participant may fill at most one role position in at most one slot;
- attendance must include the role's slot day;
- maximum fillable role cardinality is chosen first;
- among equally complete matchings, the one that removes the most required shifts is chosen.

This matching affects requirement totals only. Automatic recommendations still assign default positions; skill-dependent named roles remain a manual decision.

## Baseline calculation

The baseline is an integer full-stay requirement. For each candidate baseline, Surveyor:

1. builds the proportional stay-duration table using the selected rounding mode;
2. evaluates every participant using the normal precedence rules;
3. applies the hypothetical open-role matching;
4. compares the resulting total with full slot capacity.

The total is monotonic, so a bounded binary search finds the first candidate that reaches capacity. That candidate and its predecessor are compared, with the lower value winning a tie. Diagnostics distinguish exact coverage, a discrete rounding gap, fixed requirements already covering capacity, and plans with no stay-based participant left.

## Recommendation behavior

Required-mode recommendations target the resolved per-participant counts while respecting attendance, overlap, boundary, rejection, and approved-assignment constraints. Arrival-day morning slots and departure-day afternoon/evening slots are never eligible. Later arrival-day slots and departure-day morning slots are eligible only when their corresponding plan setting is enabled. Fairness is prioritized by fulfillment ratio and deficit. A participant's target positions are spread across their attendance window using evenly spaced temporal anchors.

Normal-capacity assignments and bounded repair run first. Repair may move an existing assignment only when it has no named role and the vacated slot can be repaired in the same bounded augmenting path. These rows are persisted and displayed as explicit reassignments rather than ordinary assignments. When `allowOverfillAfterFull` is enabled, over-capacity recommendations are added only as a last resort for remaining participant deficits. Recommendation computation runs in Node.js worker threads behind a bounded, coalescing queue; no external process or operating-system solver is required.

Submitted automatic rejections are retained as hidden participant/slot restrictions and disappear from the review UI.
If an already-running calculation emits a restricted pair, persistence exposes that row as rejected rather than pending.
Rejected manual operations are discarded and never become allocator restrictions.

## Key references

- Requirement and baseline calculations: `src/modules/activity/requirements.ts`
- Fair recommendation algorithm: `src/modules/activity/fairAssignment.ts`
- Node worker queue: `src/modules/activity/recommendationJobs.ts`
- Browser preview: `src/public/js/modules/activity/activity-requirements.ts`
