# DEC-003: Driver-list Participants Counter

<!--
documentation-metadata
audience: maintainers; documentation contributors
owner: drivers-list feature maintainers
status: current
last-verified: 2026-09-05
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: feature-specific-static-behavior
source-anchors: src/controller/driversController.ts; src/modules/database/services/DriverService.ts; src/modules/database/entities/drivers/DriversAssignment.ts; src/modules/database/entities/drivers/DriversItem.ts; src/views/drivers/drivers-view.pug; tests/integration/controller-smoke-workflows.spec.ts; docs/user-guide/DRIVERS_LISTS.md; docs/documentation-remediation.yml
next-review: D11
-->

## Decision status

**Resolved: the displayed _Participants_ counter is the number of distinct people assigned to one or more driver rows.**

In the current drivers-list model, an assignment represents a person taking a place offered by a driver row. The counter
therefore measures unique assignees—described as passengers in the user guide—not every person involved in the list.

The counter does not include a driver merely because that person created a driver row. It is also not the total number of
seat assignments: when the same profile is assigned to more than one row, that person contributes one to the counter.
A driver who is also assigned to a row is counted once because of that assignment, not because of the driver entry.

## Implementation evidence

The computation and presentation establish one consistent meaning:

- `src/controller/driversController.ts` obtains the assignees for every driver item, inserts an assignee identity into a
  set, and exposes the set size as `counters.participants`.
- The set key is based on `profileId`, so multiple assignments belonging to the same profile are deduplicated. The
  controller contains a defensive name fallback, although current persisted assignments are profile-backed.
- `src/modules/database/services/DriverService.ts` builds the assignee lists from `DriversAssignment` records joined to
  profiles. Driver identity is loaded separately from the profile that owns each `DriversItem` and is returned as
  `driverName`; it is never added to the participant set by virtue of owning the item.
- `src/views/drivers/drivers-view.pug` displays `data.counters.participants` under **Participants** and separately displays
  **Drivers** as the number of driver rows. The two figures intentionally describe different sets.
- `tests/integration/controller-smoke-workflows.spec.ts` confirms that one assignment produces a participant count of
  one. The set-based source establishes the multi-row deduplication and driver-exclusion behavior that the current test
  does not exercise directly.

The current guide statement that **Participants** means “drivers + passengers” is documentation drift tracked by
`DRV-002`; it is not the implemented behavior and does not establish a competing product definition.

## Documentation contract

### D11 — Drivers lists

The drivers-list guide must define the visible counters in plain language:

- **Participants**: unique people currently assigned to at least one driver row;
- **Drivers**: number of driver rows or ride offers, not necessarily unique people;
- **Open**: driver rows with at least one unfilled assignment place; and
- **Empty**: driver rows with no assignees.

For the **Participants** counter, the guide should include examples sufficient to remove ambiguity:

- three driver rows with no assignees show **Participants: 0**;
- one person assigned to two rows shows **Participants: 1**;
- two different assigned people show **Participants: 2**; and
- a driver-only entry does not increase **Participants**.

The novice path should use “assigned passengers” or “people assigned to rides” rather than database terms such as
assignment records or profile identifiers. An advanced note may explain that the value is deduplicated across the whole
list and is not a capacity or total-seat figure.

### D14 — In-app help validation

Semantic help checks should protect the documented meaning by asserting that the drivers guide:

- does not define **Participants** as drivers plus passengers;
- states that only assigned people contribute to the counter;
- explains that one person assigned more than once is counted once; and
- keeps **Participants** distinct from the per-row **Assigned / Max** values and the **Drivers** row count.

No runtime, test, view, or in-app guide change is part of this decision package.

## Change rule

Changing the counter to include drivers, to count raw assignments, or to represent total capacity would be a product
behavior change. Such a change would require coordinated controller, test, UI-label, D11, and D14 updates. Until then,
“unique assigned people across the list” is the authoritative meaning.
