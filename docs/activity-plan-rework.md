# Activity Plan Rework Plan & Progress

## Objectives
- Add required-shift handling for activity plans associated with events, including per-role overrides, proportional calculations based on attendance, rounding modes, and binding deadlines.
- Introduce automatic assignment recommendations that respect attendance windows, avoid overlapping slots, and allow administrators to review and edit before approval.
- Improve slot timeboxing, ordering, and UX warnings for overlaps or assignments outside attendance windows.
- Migrate slot-role management to the new permission system and support plan-level role CRUD with per-role shift requirements.
- Refresh the UI with Bootstrap components to surface the new settings, warnings, and recommendation workflow.

## Implementation Plan (Current Draft)
1. **Data Model & Migrations**: Extend activity plan/slot schemas for required-shift settings, per-role multipliers, manual overrides, timeboxes, and capacity bypass controls. Add tables for override storage and recommendation staging.
2. **Required Shift Calculation Service**: Build utilities to derive per-participant requirements based on plan mode, attendance windows, rounding mode, and overrides (role-based or manual).
3. **Availability & Timebox Utilities**: Standardize slot ordering and overlap detection using start/end times, with helpers to flag arrival/departure edge cases.
4. **Automatic Assignment Engine**: Generate fair recommendations that honor availability, avoid overlaps, and optionally bypass slot capacity. Persist recommendations separately for admin review/edit/approval.
5. **Controller/API Updates**: Expose new settings, enforce binding deadlines (non-admin lock), manage plan-level roles, and provide endpoints for recommendation lifecycle actions.
6. **Frontend Redesign**: Update plan/slot management views with mode toggles, required-shift inputs, deadline pickers, timeboxed slot display, overlap warnings, and the recommendation review panel. Use reusable Bootstrap components.
7. **Testing & Docs**: Add unit/integration/E2E coverage for calculations, validation, recommendation flows, deadline enforcement, and UI interactions. Keep documentation and inline comments current.

## Progress for This PR
- Documented the rework plan and captured the incremental workflow for upcoming work.
- Introduced timebox utilities to standardize slot ordering and overlap detection to support upcoming automatic assignment and UX warnings.
- Updated slot retrieval to order by start time (when available) to align with the new timeboxing expectations.
- Added schema support for participant- and role-specific required shift overrides alongside reusable calculators for proportional requirements and override resolution.
- Added validation helpers and database service endpoints to manage per-participant override persistence and plan-level role requirements in one transactional call.
- Added validation and API endpoints to fetch and replace role requirements and participant overrides under the manage-requirements permission guard.
- Added availability helpers to surface overlap and attendance-window warnings and wired slot creation to accept timeboxes for forthcoming UI/assignment checks.
- Created staging support for assignment recommendations (schema, entity, and normalization helpers) to back the upcoming auto-assignment review flow.
- Added recommendation management endpoints with warning generation (overlap-aware) for staged assignments to prepare the admin review workflow.
- Implemented automatic recommendation generation that balances outstanding shift requirements, respects attendance/overlap rules, and persists generated recommendations through a dedicated API endpoint.
- Added recommendation application flow with capacity-aware warnings, attendance/overlap enforcement, and an API endpoint to convert approved recommendations into applied assignments.
- Added validation for plan-level requirement settings (mode, rounding, deadlines, capacity bypass) alongside transactional updates and enforced binding-deadline locks on assignment mutations.
- Added assignment-warning APIs that surface overlap, attendance, and capacity warnings for participants before assigning slots.
- Surfaced slot timeboxes in the activity plan UI and creation flow with start/end inputs and in-view time badges to support overlap awareness.
- Added a Bootstrap-powered warning modal that consumes the new warning endpoint before users join a slot, keeping potential conflicts visible in the workflow.
- Surfaced requirement settings, per-role counts, and participant overrides in the activity plan UI with reload/save controls, and exposed recommendation review/auto-generate/apply flows with warning visibility for managers.
- Added participant requirement summaries (required vs. assigned, attendance, and source) to the requirement panel, powered by requirement calculations and attendance-aware aggregation.
- Enabled inline editing of staged recommendations with participant/slot selectors sourced from plan data while keeping warning visibility and dirty-state hints in the review panel.
- Automatically trigger recommendation generation after the binding deadline when no proposals exist, and surface the auto-generation notice in the recommendation review UI.

## Next Steps
- Extend E2E coverage for requirement management, warning displays, and the recommendation approval/apply workflow.
