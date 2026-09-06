# DEC-001: Survey Combination Authorization

<!--
documentation-metadata
audience: maintainers; documentation contributors
owner: survey feature maintainers
status: current
last-verified: 2026-09-05
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: feature-specific-static-behavior
source-anchors: src/views/surveyor/survey-vote.pug; src/routes/survey.ts; src/controller/surveyController.ts; src/middleware/guestFlowFactory.ts; src/modules/database/services/SurveyService.ts; docs/decisions/DEC-005-SURVEY-CREATION-PERMISSIONS.md; docs/documentation-remediation.yml
next-review: D09
-->

## Decision status

**Resolved: adding a date combination is a collaborative survey-participant action.**

Every person who has been admitted to the survey page with an active profile may add another weekday/week-of-month
combination. This includes the survey owner, signed-in account holders, and registered guests. A person does not need to
be the owner or an administrator, and surveys do not use a generic permission bit for this action.

The authorization boundary is the survey's existing view-and-participation access boundary: a person who may open the
voting page may also use **Add new combination**. An anonymous visitor who has not yet established a profile cannot
submit the action; the normal survey entry flow first directs that visitor through guest registration or sign-in.

## Implementation evidence

The feature-specific implementation is internally consistent:

- `src/views/surveyor/survey-vote.pug` renders **Add new combination** unconditionally on the voting page. It is not
  wrapped in an owner, administrator, or permission check.
- `src/routes/survey.ts` registers `POST /survey/:id/add-combination` without `requireOwner`, `requirePermission`, or a
  survey-specific administrative guard.
- Requests to that route first pass through the shared survey access safe zone in
  `src/middleware/guestFlowFactory.ts`. That access gate admits a profile that may participate in the survey and sends a
  visitor without a profile through the guest-entry flow.
- `src/controller/surveyController.ts` validates the submitted weekday and week-of-month values, then adds the
  combination. It does not perform an owner or administrator check.
- `src/modules/database/services/SurveyService.ts` stores the combination for the selected survey; no permission record
  is consulted or created.

This evidence establishes a deliberate collaborative workflow rather than an accidental omission of the general
permission system. [DEC-005](DEC-005-SURVEY-CREATION-PERMISSIONS.md) remains controlling: surveys use their own access
and participation model.

## Documentation contract

### D09 — Surveys

The survey guide must:

- state that every participant who can open the survey may add a date combination;
- explicitly include both registered participants and registered guests;
- avoid describing the action as owner-only, administrator-only, or permission-controlled;
- explain that **Add new combination** is available on the voting page and that the new option becomes available to all
  participants; and
- distinguish collaborative combination creation from owner-only lifecycle actions such as deleting the survey.

The beginner path should use role-neutral language such as “any participant” and should not expose middleware or route
terminology. Advanced notes may explain that a participant must first enter the survey through its normal access flow.

### D14 — In-app help validation

Semantic help checks should protect the stable contract by asserting that:

- the guide says participants can add combinations;
- it does not claim that only owners or administrators can do so; and
- the documented **Add new combination** label exists on the rendered voting page.

Runtime authorization tests are outside this documentation-only decision package. A later application test package may
add direct owner, account-holder, guest, and anonymous-request coverage without changing the documented behavior.

## Change rule

Restricting combination creation in the future would be a product behavior change, not a documentation correction. Such
a change would require an explicit survey-specific authorization decision, implementation and test changes, and a
coordinated update to D09 and D14.
