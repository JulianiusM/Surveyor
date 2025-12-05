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

## Next Steps
- Wire the timebox utilities into assignment validation to surface overlap/availability warnings in the UI.
- Extend the data model with migration(s) for per-role requirements, manual overrides, and recommendation staging.
- Build controller/service wiring that consumes the new requirement calculators, enforces binding deadlines, and exposes overrides via the API.
