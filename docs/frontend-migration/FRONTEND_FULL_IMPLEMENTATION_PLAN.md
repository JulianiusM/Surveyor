# Full frontend implementation plan
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers; AI agents
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-15
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: editorial reconciliation of P0/P1 delivery, follow-up disposition and the maintainer's definition-guard correction; original future phase contracts retained; no new runtime verification
source-anchors: docs/frontend-migration/PROFILE.md; docs/frontend-migration/FRONTEND_FOUNDATION_DESIGN.md; docs/frontend-migration/FRONTEND_PILOT.md; docs/frontend-migration/PILOT_PARITY_REVIEW.md; docs/frontend-migration/staged/DEVELOPMENT.md; docs/policies/DEVELOPMENT_POLICY.md; docs/backlog/documentation-remediation.yml
next-review: authorized-migration-follow-up-or-next-phase
-->

## Current disposition (2026-10-15)

P0 readiness and P1A–D identity/common presentation have recorded implementation and scoped verification in the
[P0 receipt](PILOT_PARITY_REVIEW.md#p0-foundation-verification-2026-10-14) and
[P1 receipt](PILOT_PARITY_REVIEW.md#p1-migration-verification-2026-10-14). Those earlier receipts retain their limits.
The [follow-up review](PILOT_PARITY_REVIEW.md#pilot-review-follow-up-2026-10-14) records the implemented shared action
state and restoration of direct native profile-operation reuse, with scoped verification. The maintainer's
[2026-10-15 correction](../decisions/DEC-006-FRONTEND-FRAMEWORK.md#maintainer-correction-2026-10-15) supersedes the
follow-up's A5 interpretation: unused implementation removal did not authorize schema-definition bans. Those guards
are removed, with [generation verification](PILOT_PARITY_REVIEW.md#definition-guard-correction-verification-2026-10-15)
and no restored runtime transport support. The follow-up does not broaden the earlier receipts into full-application
or deployment acceptance.

P2–P10 remain future phase contracts. P11 retains its separate cutover, publication and retirement authorization
requirements. This plan records the sequence and acceptance boundaries; implementation proceeds only within the
maintainer's applicable authorization. The original phase contracts and dated backend-remedy exclusions below remain
in force, alongside the [approved decision history](FRONTEND_FOUNDATION_DESIGN.md#original-decisions-and-dated-amendments).

## Phase contracts

Use **small vertical migrations with parallel feature streams**, keeping Events on the main dependency path and
splitting Activities and finance into independently reviewable packages.

The phase numbers give the recommended delivery order. Only the stated prerequisites should block work: Drivers and
Surveys do not need the Vue Event pages to be finished, and finance does not depend on Activity migration.

Every package should follow the
existing [migration playbook](staged/DEVELOPMENT.md#adding-or-changing-a-feature-view).

1. **P0 — Close the identified readiness gaps**  
   **Complexity:** Medium. **Prerequisites:** None.

    - Diagnose the generator watcher failure using recorded phases, child output, and cleanup evidence. Correct its
      demonstrated cause without weakening assertions.
    - Complete method contracts and internal comments in migration-modified permission and Help operations.
    - Correct stale maintenance evidence while preserving original discoveries and approved decisions.
    - Establish the current build, generation, compiler, and focused-test results that subsequent agents will inherit.

   **Completion:** the watcher failure has an explained disposition, changed operations satisfy readability
   requirements, and the handoff distinguishes passing checks from remaining limitations. Read-only feature inventories
   can proceed alongside this phase.

2. **P1 — Complete identity administration and common presentation**  
   **Complexity:** High. **Prerequisites:** P0 for implementation; existing pilot identity infrastructure remains the
   foundation.

   Split this into separate packages:

    - **P1A: Profile management.** Active-profile editing, account-owned profile listing and creation, and adoption of
      the existing profile-switch operation.
    - **P1B: Profile transfer.** Migration-token issuance, token entry, private preview, and explicit execution.
    - **P1C: Destructive identity workflows.** Profile deactivation and full/guest account deletion, with their distinct
      confirmations, remaining-profile selection, mail, session, and provider consequences.
    - **P1D: Common presentation.** Landing page, message pages, and error presentation. Use an explicit opt-in landing
      route; preserve `/frontend-pilot` as Overview during coexistence. Keep configured privacy/imprint destinations as
      external links and `/healthz` as an Express endpoint.

   **Existing owners:** `userController`, `UserService`, existing identity components and session-completion
   infrastructure.

   **Completion:** account/guest distinctions, ownership, token handling, rejected and unknown outcomes, and
   private-cache retirement are protected. Login, registration, recovery, activation, and profile switching are reused
   rather than implemented again.

   **Approved correction (2026-10-14):** the original P1B/C finality-review prerequisite does not require backend
   remediation before frontend migration. The review identified existing defects; the maintainer explicitly excludes
   R1A/R1B token-authority strengthening, R2 transfer finality, R3 deactivation finality and R4 deletion finality, along
   with all existing backlog remedies. Complete visual/behavioral parity through existing shared operations, allowing
   minor transport/presentation reuse. Those remedies stay deferred and do not block these frontend packages.

3. **P2 — Migrate Events and establish shared event context**  
   **Complexity:** High. **Prerequisites:** P0; existing identity and guest-entry contracts. Can overlap P1.

   Implement three packages in order:

    - **P2A: Event foundation.** Bounded Event projections, creation/duplication, dates, timezone/deadline controls,
      metadata, images, permissions, and archival.
    - **P2B: Participant workflows.** Registration/update/cancellation, arrival/departure, dietary fields, deadline
      variants, and registration-token continuity.
    - **P2C: Organizer workflows.** Authorized roster and totals, registration editing/removal, bypass-link management,
      participant PDF, and Things to do.

   **Existing owners:** `eventController`, `entityAdminController`, `EventService`, existing registration and export
   owners.

   Do not expose the current complete Event view aggregate as a DTO: it also contains invoice data. Define permitted
   projections inside the existing owners.

   **Completion:** repeated registration updates rather than duplicates; page, roster, and management permissions remain
   distinct; token entry is preserved without consumption during prefetch; date/timezone behavior matches native
   behavior.

   Invoice controls may retain working native destinations until their phases finish.

4. **P3 — Migrate Drivers as the first substantial reuse exercise**  
   **Complexity:** Medium–High. **Prerequisites:** P0 and a shared guest-entry interface. Can overlap P2.

    - Generalize the existing guest-entry owner when the first additional feature adopts it. Inject operations, query
      keys, context, and destinations; update Packing and the new consumer together. Do not copy `PackingGuestPage`.
    - Define Drivers contracts and shared controller operations, including method-specific permissions.
    - Implement create/duplicate, entry/detail, settings, ride creation/editing/reordering/deletion, passenger
      assignment/removal, and organizer removal.
    - Connect accepted destinations and actions to Overview, navigation, and event children.

   **Existing owners:** `driversController`, `DriverService`, shared administration/event/image/lifecycle owners.

   Preserve Drivers semantics: the offering profile supplies the driver identity; offering a ride consumes no passenger
   place; one profile may offer or join multiple rides. Add no Packed or Everyone behavior.

   **Completion:** DRV-01–04 and applicable ENT behaviors have source-to-implementation mappings, coexistence evidence,
   and desktop/mobile comparison. Extract shared Packing/Drivers interactions only where both consumers actually adopt
   them.

5. **P4 — Migrate Surveys independently**  
   **Complexity:** Medium. **Prerequisites:** P0 and shared guest-entry contracts. Can run alongside Drivers or Events.

    - Implement creation/duplication and recurring weekday/occurrence choices.
    - Implement ballot drafts, submission, named results, and collaborative combination creation.
    - Compose applicable owner settings, image, archive, duplicate, and deletion controls.
    - Connect Survey navigation and Overview actions.

   **Existing owners:** `surveyController`, `SurveyService`.

   Preserve the deliberate exceptions: Surveys remain standalone; they gain no event association, general permission
   matrix, or generic administrator setup. Any admitted account/guest profile may add combinations.

   **Completion:** SRV-01–05, foreign-choice rejection, profile isolation, omitted-answer behavior, dirty ballots during
   refresh, and newly added combinations are covered.

   Do not claim atomic concurrent ballot replacement already exists. Any stronger persistence guarantee requires a
   separately reviewed scope.

6. **P5 — Migrate basic Activity planning and participation**  
   **Complexity:** High. **Prerequisites:** stable Event admission/attendance contracts from P2; completed Event UI is
   not inherently required.

   Implement two packages:

    - **P5A: Root and schedule.** Create/duplicate, settings, schedule projection, All/My/Open filters, shared text
      fields, and the separate printable schedule.
    - **P5B: Slots and assignments.** Slot CRUD/reordering, roles and quantities, self participation, organizer
      assignment, warning review, and explicit confirmation.

   **Existing owners:** `activityController`, `ActivityService`, existing warning and assignment engines.

   Preserve standalone/linked differences, named-role versus ordinary assignment, external participation, permitted
   overfill, attendance/deadline rules, and sibling-plan privacy.

   **Completion:** ACT-01–07 and relevant context-change behaviors pass. Warning confirmation precedes the write;
   cancellation preserves the draft; changed warnings require fresh review. The printable schedule remains an authorized
   standalone document.

7. **P6 — Migrate advanced Activity workflows**  
   **Complexity:** Very high. **Prerequisites:** P5 and stable Event context.

   Implement three sequential packages:

    - **P6A: Requirements and progress.** Free/Required modes, binding deadline, stay tables, rounding, role
      requirements, participant overrides, and unsaved coverage.
    - **P6B: Recommendation jobs.** Explicit generation, job identity, progress, terminal states, stale context, and
      uncertain dispatch.
    - **P6C: Reviewed changes.** Approve/reject/revert/remove, manual assignment/unassignment/reassignment/swaps,
      warning acknowledgement, and exact-batch application.

   Reuse the existing pure requirements engine for coverage and the existing server recommendation engines for
   generation and application.

   **Critical boundary:** `getRecommendations` performs maintenance and can enqueue work. It must not become an ordinary
   periodically polled DTO endpoint. Preserve domain job observation and resolve any changed invocation semantics
   directly.

   **Completion:** ACT-08–14, zero/override precedence, dirty requirement recovery, manual/generated provenance, both
   swap legs, stale-review rejection, and applied/skipped results are protected.

8. **P7 — Migrate finance read models and participant invoices**  
   **Complexity:** High. **Prerequisites:** P2’s Event participation and authorization contracts. Can overlap Activity
   migration.

    - Define separate participant and organizer projections through existing invoice owners.
    - Build reusable history, totals, ledger, and lazy breakdown presentation against existing saved data.
    - Implement eligible pool selection, invoice/proof submission, progress, definite rejection, uncertain delivery,
      history inspection, retraction, and participant close.
    - Preserve proof authorization and retention independently of invoice status.

   **Existing owners:** `eventPoolController`, existing invoice operations, presentation, proofs, and DBAL.

   **Completion:** INV-03–06/20 and the relevant read behaviors pass. Unknown uploads cannot replay automatically;
   confirmed success releases only completed inputs; recorder, attributed participant, and proof owner remain distinct.

9. **P8 — Migrate organizer finance and allocation inputs**  
   **Complexity:** High. **Prerequisites:** P7.

   Split into two packages:

    - **P8A: Pools and invoice review.** Pool creation/settings, OPEN/ORGANIZER_ONLY submission access, organizer
      expenses, acceptance/correction/rejection/closure, and revision-reviewed retroactive changes.
    - **P8B: Allocation and coverage.** Enrollment, factors/exemptions, signed adjustments, surcharges/rebates, and
      participant/organizer takeover controls.

   **Existing owners:** the same EventPool controller and existing pool, invoice, and takeover operations.

   **Completion:** independent form save boundaries remain; original evidence and recorder attribution survive
   corrections; pending allocation changes do not replace saved shares; participant and organizer authority remain
   distinct.

   Serialize these packages because they share major controller and domain files.

10. **P9 — Migrate financial calculation, settlement, and outputs**  
    **Complexity:** Very high. **Prerequisites:** P8.

    Implement three sequential packages:

    - **P9A: Reviewed calculation.** Saved-input preview, breakdown/example, captured revision, close/calculate,
      recalculation, and rollback.
    - **P9B: Settlement interaction.** Saved ledgers, payment/refund recording and reversal, confirmations, pending
      controls, stable action rows, filtering, and explicit refresh.
    - **P9C: Outputs.** Calculation email choice, later settlement email delivery, shares-PDF variants, and final
      proof/history privacy checks.

    Preserve financial arithmetic, signed values, rounding, carried payments/refunds, and existing revision semantics.
    Packing comparisons must not replace financial review contracts.

    **Completion:** stale previews cannot commit; unknown writes cannot replay; recalculation preserves recorded
    transfers; exports use the full authorized saved ledger regardless of browser filters and never calculate or settle
    anything.

11. **P10 — Complete cross-application integration**  
    **Complexity:** High. **Prerequisites:** all feature packages complete.

    - Verify every creation/detail/duplicate/administration destination and remove remaining native interactive
      destinations from migrated journeys.
    - Complete mixed-family Overview actions, authorized images, parent grouping, independent hidden regions, counts,
      history, focus, and personal visibility.
    - Verify account/profile changes, expiry, revocation, late responses, retained drafts, deployment updates, and
      unknown commands across feature boundaries.
    - Compare representative native/new desktop/mobile states using equivalent actors and data.
    - Reconcile staged guidance and review remaining unique contracts before retirement.

    All migrated UI/API text must use the existing shared catalogs throughout the earlier phases. Persisted principal
    language and full email/PDF localization remain separate extensions requiring their own scope; they must not be
    silently added or made prerequisites for framework migration.

    **Completion:** the full interactive application is available through the new frontend, with no unexplained parity
    difference or unfinished navigation path.

12. **P11 — Perform separately authorized cutover and retirement**  
    **Complexity:** High operational risk. **Prerequisites:** P10 acceptance.

    Treat these as separate actions:

    - Adopt default routes while preserving bookmarks, provider/token links, downloads, exports, and correct
      error/status handling.
    - Publish independently reviewed documentation from its exact prepared bytes.
    - Retire superseded native interactive views, browser modules, adapters, and comparator tooling using the existing
      retirement inventory.
    - Retain shared controllers, DBAL, domain engines, assets/helpers still consumed, and mail/PDF/print/download
      owners.

    Native preservation ends at authorized cutover. It must not become a permanent second frontend.

For parallel execution, use **one integration owner and up to three feature streams**. The integration owner coordinates
shared route tables, bootstrap/query contracts, navigation/Overview wiring, root OpenAPI references, catalogs, and
generated inputs. Feature agents own their feature contracts, adapters, views, existing controller extensions, and
focused tests. Database-backed verification must use independently owned targets or run serially.

Every agent handoff must contain:

- Actual authorization, governing context, owned files, prerequisites, and unresolved decisions.
- Selected behavior and edge-case IDs from the existing inventories.
- Native/v1 callers adopting the same business operations.
- Draft, identity, permission, file, concurrency, and completion boundaries.
- Executed checks and their limits, plus independent semantic review.
- Remaining work and the next package’s producer contracts.

Across all phases, shared contracts remain `.d.ts`; controllers retain business logic; services remain DBAL; complex
operations require both method contracts and internal explanations. **Approved correction (2026-10-14):** general
defects and existing backlog remedies are excluded from this frontend migration and must not become prerequisites.
The original dependent-decision wording does not require reopening those exclusions. Preserve shared native business
behavior except for explicitly approved frontend changes; minor backend transport/presentation adaptation is allowed.
New frontend/adapter code still follows the established engineering and security requirements. Documentation
diagnostics remain advisory.
