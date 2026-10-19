# Full frontend implementation plan
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers; AI agents
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-19
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: P6 adoption and full-pilot review qualifications reconciled alongside retained P0-P5 evidence; unresolved localization, feedback, Refresh and guide decisions explicit; P7-P11, backend exclusions and cutover boundaries preserved
source-anchors: docs/frontend-migration/PROFILE.md; docs/frontend-migration/FRONTEND_FOUNDATION_DESIGN.md; docs/frontend-migration/FRONTEND_PILOT.md; docs/frontend-migration/PILOT_PARITY_REVIEW.md; docs/frontend-migration/staged/DEVELOPMENT.md; docs/policies/DEVELOPMENT_POLICY.md; docs/backlog/documentation-remediation.yml
next-review: authorized-migration-follow-up-or-next-phase
-->

## Current disposition (2026-10-18)

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

The [session-ownership restoration](FRONTEND_FOUNDATION_DESIGN.md#session-ownership-restoration-and-stateless-initial-visits-2026-10-15)
has current bounded verification in the [session receipt](PILOT_PARITY_REVIEW.md#pilot-session-admission-correction-2026-10-15).
The earlier R1 architectural acceptance and defect closure are withdrawn; its successful tests do not certify this
changed mechanism. The original overwrite defect is now verified repaired under the latest explicit authorization.
The [native-flash decision](FRONTEND_FOUNDATION_DESIGN.md#authorized-native-anonymous-session-flash-2026-10-15)
resolves the former account-required notice blocker: retain the ordinary anonymous Session and one-time notice,
not a URL parameter. Message-free initial reads remain uninitialized. `ARCH-005` owns the separate whole-session/
flash review and does not block parity migration. The
[full baseline re-review](PILOT_PARITY_REVIEW.md#full-pilot-baseline-and-migration-readiness-re-review-2026-10-15)
finds the foundation ready for the next authorized parity-only slice with its recorded limits; this is not
full-application acceptance or approval to implement every later phase.

P2A–C have a prior scoped completion receipt under the maintainer's request to fully implement P2, with its evidence and limits in
the [completion receipt](PILOT_PARITY_REVIEW.md#full-p2-implementation-completion-2026-10-16). Event creation/duplication,
settings, attendance, organizer tools and related-resource context now use the opt-in frontend. Packing and Event
adopt the shared displayed header, entry, guest, settings, metadata, access and lifecycle owners; invoice and unmigrated child pages
retain their working native destinations. Native frontend inputs remain unchanged.

The maintainer's [October 16 S1 decision](FRONTEND_FOUNDATION_DESIGN.md#authorized-implemented-pilot-scope-2026-10-16)
limited that delivery to the implemented P0–P2 slice. P3–P11 were later phase contracts, triggered only after stable
repeated reviews of the implemented slice and an explicit future maintainer instruction. P11 additionally retains
separate cutover, publication and retirement authorization. This plan records sequence and acceptance, not automatic
continuation. Existing phase contracts and backend-remedy exclusions remain in force alongside the
[approved decision history](FRONTEND_FOUNDATION_DESIGN.md#original-decisions-and-dated-amendments).

The maintainer's [October 18 explicit P3 instruction](FRONTEND_FOUNDATION_DESIGN.md#explicit-p3-implementation-trigger-2026-10-18)
starts Drivers under the phase contract below. It does not start P4–P11 or change the separate cutover decisions.
The subsequent [direct frontend-only clarification](FRONTEND_FOUNDATION_DESIGN.md#direct-frontend-only-implementation-and-native-isolation-clarification-2026-10-18)
retains native isolation and excludes the deeper shared administration refactor from these frontend corrections;
the existing backlog owns that debt. It grants no later-phase continuation.

The subsequent [explicit P4 instruction](FRONTEND_FOUNDATION_DESIGN.md#explicit-p4-implementation-trigger-2026-10-18)
starts standalone Surveys under the existing phase contract. Its
[receipt](PILOT_PARITY_REVIEW.md#p4-surveys-implementation-and-scoped-verification-2026-10-18) records its original evidence
and its original Vue-only defect questions. The later approved frontend exceptions resolve those questions without
granting P5–P11 or cutover authority; the native defect records remain open until cutover.

The [October 16 full-pilot review](PILOT_PARITY_REVIEW.md#current-acceptance-and-correction-boundary-2026-10-16)
qualifies earlier readiness statements with its scalar-display, visual-assertion and verification-environment
findings. The maintainer authorizes their correction and existing-guidance reconciliation. The subsequent
[complete pilot-readiness receipt](PILOT_PARITY_REVIEW.md#complete-pilot-readiness-correction-and-scoped-verification-2026-10-18)
owns renewed shared-implementation, P4 parity and complete execution results with their finite limits. Earlier
phase receipts retain their original scopes; no later phase or cutover authority follows from passing checks.

## Completed SPA correction (2026-10-16)

The maintainer's [direct E1/D1 reply](FRONTEND_FOUNDATION_DESIGN.md#direct-production-coexistence-exclusion-and-spa-correction-2026-10-16)
excludes production coexistence coordination and rejects ordinary Event document submissions. The completed
correction's execution sequence remains in Git history. Its lasting contribution rules belong to the existing
[playbook](staged/DEVELOPMENT.md#adding-or-changing-a-feature-view); its behavior-to-assertion mappings belong to the
[coverage map](TEST_COVERAGE.md#adopted-spa-correction-assertions-2026-10-16).

The correction restored generated SPA commands, shared Vue owners and ordinary Router navigation; displaced
document-only Vue command adapters/helpers are retired. Its failed attempts, focused corrections and scoped
verification remain in the paired review rather than another active execution checklist.

`DESIGN-EVENT-CREATION-TRANSPORT` retains its reviewed closure in the central backlog. The
[current review](PILOT_PARITY_REVIEW.md#complete-pilot-readiness-correction-and-scoped-verification-2026-10-18) owns actual inputs,
execution and remaining limits. The subsequent approved R1 identity-notice adaptation changes presentation, not
the shared command transport or inherited operation guarantees. General backend completion remedies remain excluded.

The subsequent [explicit P5 instruction](FRONTEND_FOUNDATION_DESIGN.md#explicit-p5-implementation-trigger-2026-10-18)
starts basic Activity planning and participation under its existing contract. The instruction covers P5A and P5B;
it does not start advanced Activity workflows, the later finance phases or cutover.
Both packages now have an [implementation and scoped verification receipt](PILOT_PARITY_REVIEW.md#p5-basic-activity-implementation-and-scoped-verification-2026-10-18).
The declared P5 journeys are complete; requirement editing/recommendations remain P6. Earlier receipts retain their
original inputs and limits rather than becoming an assertion that the full application has migrated.

The subsequent [explicit P6 instruction](FRONTEND_FOUNDATION_DESIGN.md#explicit-p6-implementation-trigger-2026-10-18)
starts all three advanced Activity packages. Requirements and unsaved coverage, domain-job observation and reviewed
manual/generated batches now have production Vue owners and generated transport through the existing Activity
controller and engines. The [P6 source map](TEST_COVERAGE.md#p6-advanced-activity-source-map-2026-10-18) identifies
actual consumers and assertions. The [P6 receipt](PILOT_PARITY_REVIEW.md#p6-advanced-activity-implementation-and-scoped-verification-2026-10-19)
records passing build, mounted, persistence and built-browser selections plus original visual review and finite limits.
The declared P6 journeys implement the native workflows with the directly approved Vue job-observation exception. That fix
uses the existing read operations without backend changes; IMP-030 remains open until native-to-Vue cutover.
The subsequent [full review](PILOT_PARITY_REVIEW.md#full-implemented-pilot-review-2026-10-19) qualifies readiness:
the existing Activity named-element translations conflict with the deferred design choice, German badges remain
untranslated, and German Rules rows crowd at narrow widths. Healthy Refresh presentation, the inherited first-install
guide contradiction and recommendation follow-up feedback also retain explicit unresolved decisions. These findings
prevent an unconditional P5/P6 compliance or rapid-migration-readiness claim; they are not approved future work.
P7–P11 and cutover remain separately scoped.

## Phase contracts

The maintainer's [native-frontend isolation decision](FRONTEND_FOUNDATION_DESIGN.md#authorized-native-frontend-isolation-decision-2026-10-15)
answers the later R1 native-helper/browser-build proposal, separately from the earlier automatic-reload R1. It rejects
shared native-password extraction. Native frontend code stays untouched and is removed only after full
migration and authorized cutover. The new frontend owns required copied behavior; temporary native/new duplication
is accepted. New-frontend consumers still share their owners, while backend/domain/controller/DBAL/catalog code remains
shared. The subsequent instruction to implement the bounded adaptation is realized in the existing frontend feedback
owner and `src/frontend/styles/`: receipt-owned ten-second scheduling/cancellation replaces the native timer import,
and authored `style.sass`, `accordion.sass`, `timezone-select.sass` and `help.sass` replace native stylesheet links.
`application.sass` is their single cascade-composition owner with existing pilot overrides, consumed by both the client
entry and development renderer. No native global alert system, second command/state owner or generated CSS copy is
introduced.
The [October 16 R1 clarification](FRONTEND_FOUNDATION_DESIGN.md#direct-native-isolation-clarification-2026-10-16)
confirms separately mutable Vue copies, with shared presentation/frontend logic required only among matching Vue
consumers. Backend/domain/catalog ownership remains distinct from that native isolation boundary.

The copied graph retains installed Bootstrap SCSS, currently 5.3.8, alongside the renderer's existing Bootstrap 5.3.3
CDN layer. Preserve that effective cascade, stylesheet order, dark geometry and Help rules; this is not authorization
to deduplicate vendor layers. Ordered Vite client/SSR delivery keeps SSR/static Help styled before JavaScript runs.
Native Sass/browser/build inputs, shared logo/favicon assets and third-party packages remain intact. The
[implementation receipt](PILOT_PARITY_REVIEW.md#native-frontend-isolation-implementation-2026-10-15) owns the current
dependency, notice-lifetime and presentation evidence with its limits. Original frontend sharing choices remain in
dated history; general backend defects, future feature phases and separately authorized cutover retain their exclusions.

Use **small vertical migrations with parallel feature streams**, keeping Events on the main dependency path and
splitting Activities and finance into independently reviewable packages.

The phase numbers give the recommended delivery order. Only the stated prerequisites should block work: Drivers and
Surveys do not need the Vue Event pages to be finished, and finance does not depend on Activity migration.

Every package should follow the
existing [migration playbook](staged/DEVELOPMENT.md#adding-or-changing-a-feature-view).

1. **P0 — Foundation readiness; recorded complete.** The original package covered generation-timeout diagnosis,
   meaningful permission/Help comments, corrected maintenance evidence and an honest build/compiler/test handoff.
   Its [receipt](PILOT_PARITY_REVIEW.md#p0-foundation-verification-2026-10-14) preserves the unresolved original timeout
   cause, measured fixture cost, unchanged assertions/deadlines and actual verification limits. Completed execution
   steps remain in Git rather than another active checklist.

2. **P1 — Identity administration and common presentation; recorded complete.** P1 used the existing identity
   foundation after P0. Its original packages remain identifiable:

    - **P1A:** current-profile editing, account-owned roster/creation and existing profile switching.
    - **P1B:** token issuance, entry, private preview and explicit profile transfer.
    - **P1C:** profile deactivation and full/guest account deletion with distinct confirmations, remaining-profile,
      mail, session and provider consequences.
    - **P1D:** opt-in landing, message and error presentation. `/frontend-pilot` remains Overview; configured
      privacy/imprint links remain external and `/healthz` remains Express-owned.

   Existing `userController`, `UserService`, identity components and session-completion owners retain responsibility.
   The [receipt and direct-reuse correction](PILOT_PARITY_REVIEW.md#p1-migration-verification-2026-10-14) distinguish
   account/guest admission, ownership, private-cache retirement, rejected/unknown outcomes and current native reuse
   from superseded stronger wrappers. Login, registration, recovery, activation and profile switching are reused.

   **Approved correction (2026-10-14):** the original P1B/C finality-review prerequisite does not require backend
   remediation before frontend migration. The review identified existing defects; the maintainer explicitly excludes
   R1A/R1B token-authority strengthening, R2 transfer finality, R3 deactivation finality and R4 deletion finality, along
   with all existing backlog remedies. Complete visual/behavioral parity through existing shared operations, allowing
   minor transport/presentation reuse. Those remedies stay deferred and do not block these frontend packages.

3. **P2 — Migrate Events and establish shared event context; complete against the phase contract.**
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

   The [P2 receipt](PILOT_PARITY_REVIEW.md#p2-event-migration-verification-2026-10-16) records actual source adoption,
   native comparisons and executed checks. Its environmental and coverage limits do not imply full-application,
   exhaustive timezone/race/accessibility or cutover acceptance. The original package and completion contracts above
   remain the comparison boundary.
   The later [full P2 review](PILOT_PARITY_REVIEW.md#full-p2-completeness-and-migration-readiness-review-2026-10-16)
   records corrections to parity, shared method policy and read/disclosure lifetimes, plus the resulting readiness
   assessment. It does not supersede the original design or authorize later phases.
   The subsequent [completion receipt](PILOT_PARITY_REVIEW.md#full-p2-implementation-completion-2026-10-16) corrects
   overlooked duplication and weak browser assertions, records actual shared header/metadata/lifecycle/entry adoption,
   and verifies all P2 packages together through the final built selection. No task-owned P2 functionality is deferred.

4. **P3 — Migrate Drivers as the first substantial reuse exercise; implemented against the phase contract.**

   **Complexity:** Medium–High. **Prerequisites:** P0 and a shared guest-entry interface. Can overlap P2.

    - Generalize the existing guest-entry owner when the first additional feature adopts it. Inject operations, query
      keys, context, and destinations; update Packing and the new consumer together. Do not copy `PackingGuestPage`.
      **Fulfilled by P2's first additional consumer:** Drivers must now adopt `identity/GuestEntryPage` alongside
      Packing and Event rather than perform another extraction or restore a feature-specific copy.
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

   The [October 18 completion receipt](PILOT_PARITY_REVIEW.md#p3-drivers-implementation-and-scoped-verification-2026-10-18)
   records actual shared adoption, scoped passing checks, visual comparison and inherited-defect/environment limits.
   That receipt supplies no P4–P11 trigger; no task-owned P3 workflow is assigned to a later phase. The subsequent
   P4 trigger and implementation retain their own contract below.

5. **P4 — Migrate Surveys independently; implemented against the phase contract.**
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

   The [October 18 receipt](PILOT_PARITY_REVIEW.md#p4-surveys-implementation-and-scoped-verification-2026-10-18)
   maps source adoption, tests and inspected desktop/mobile comparisons. The later
   [approved frontend exceptions](FRONTEND_FOUNDATION_DESIGN.md#approved-pilot-correction-and-survey-frontend-exceptions-2026-10-18)
   permit visible Vue descriptions and complete duplicate prefill. The native defects remain open until cutover;
   neither frontend correction closes its legacy record. No task-owned P4 workflow is deferred to P5.

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

   **Current implementation:** `ActivityRequirements` owns the independent lexical settings draft and composes
   `ActivityParticipants` with unsaved results from the same pure requirements engine. `ActivityRecommendations`
   owns reviewed rows and exact-batch submission; its schedule and manual editor share feature presentation and
   existing warning/dialog owners. Deliberate entry, Reload, explicit generation completion and confirmed
   application retain native maintenance triggers. Recovery snapshots and ordinary job-status reads cannot maintain
   rows or enqueue work. The existing controller retains generation, provenance, warning privacy and application
   decisions; no stronger legacy completion guarantee is introduced. Verification status belongs to the paired review.

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
    - After native browser-pipeline retirement and before verbatim guide publication, reconcile exact staged mappings,
      commands, generated-file/watch instructions and source inventories with the final executable configuration.
      Current native/esbuild inventories remain truthful until that retirement; do not invent replacement commands.
    - Remove all native frontend code after full migration, then retire native adapters and comparator tooling through
      the existing inventory. Required copied behavior already belongs to new-frontend owners.
    - Retain shared controllers, DBAL, domain engines/catalogs, common image assets, third-party packages and
      mail/PDF/print/download owners; none justifies retaining native frontend application code.

    Native preservation ends at authorized cutover. It must not become a permanent second frontend.

For parallel execution, use **one integration owner and up to three feature streams**. The integration owner coordinates
shared route tables, bootstrap/query contracts, navigation/Overview wiring, root OpenAPI references, catalogs, and
generated inputs. Feature agents own their feature contracts, adapters, views, existing controller extensions, and
focused tests. Database-backed verification must use independently owned targets or run serially.

Every agent handoff must contain:

- Actual authorization, governing context, owned files, prerequisites, and unresolved decisions.
- Selected behavior and edge-case IDs from the existing inventories.
- Native/v1 callers adopting the same business operations.
- New-frontend consumers adopting one frontend owner without direct native frontend imports; any temporary
  native/new copy and the actual dependency/parity evidence under the approved isolation decision.
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
