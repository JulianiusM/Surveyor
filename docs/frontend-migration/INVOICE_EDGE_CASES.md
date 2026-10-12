# Invoice, pool, settlement, and proof edge cases

<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: current
last-verified: 2026-10-04
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: second-pass source review of invoice controllers, functional operations, DBAL, Pug/browser behavior, and actual existing test assertions; no tests, database operations, email deliveries, or PDF visual checks executed for this review
source-anchors: src/controller/eventPoolController.ts; src/modules/invoice/; src/modules/database/services/EventInvoiceService.ts; src/public/js/events.ts; src/public/js/modules/invoice-submission.ts; src/views/modules/module_invoice_pool.pug; tests/unit/invoice-distribution.spec.ts; tests/unit/invoice-settlements.spec.ts; tests/unit/invoice-shares-pdf.spec.ts; tests/frontend/invoice-submission.spec.ts; tests/frontend/invoice-admin-ui.spec.ts; tests/frontend/invoice-calculation-preview.spec.ts; tests/integration/invoice-workflows.spec.ts; tests/integration/invoice-history-changes.spec.ts; tests/integration/organizer-invoices.spec.ts; tests/integration/invoice-admin-feedback.spec.ts; tests/e2e/invoice-pools.spec.ts; tests/e2e/invoice-organizer-expenses.spec.ts; docs/backlog/documentation-remediation.yml
next-review: invoice-contract-or-frontend-cutover
-->

This is the invoice-specific acceptance detail behind INV-01–INV-20 and EXP-03 in the
[behavior inventory](BEHAVIOR_INVENTORY.md). The [route inventory](ROUTE_INVENTORY.md) owns HTTP paths;
the [test coverage review](TEST_COVERAGE.md) owns suite scope. Stable EC-INV IDs identify observable
conditions to preserve, including intentional asymmetries. An existing assertion below means its source was
read, not that the test passed in this review. Suggested validation names the cheapest useful boundary when
migrating the affected behavior; it does not prescribe additional tests for unchanged code.

## Pool state and attribution

### EC-INV-001 — Submission closure is distinct from calculation closure

- **Trigger/actor/state:** An organizer creates a pool or switches participant submissions before calculation.
- **Invariant:** Creation defaults to OPEN and can explicitly select ORGANIZER_ONLY. OPEN and ORGANIZER_ONLY
  have no calculated shares merely because of their state. Switching between them requires the current
  `expectedRevision`; it preserves invoices and assignments, advances the revision for an actual change,
  and does not set `closedAt`, create a snapshot, or mark an uncalculated pool stale. CLOSED cannot switch
  back through this command. A same-state request still checks the supplied revision.
- **Evidence:** [request parsing](../../src/modules/invoice/requests.ts),
  [savePoolSubmissionState](../../src/modules/invoice/poolOperations.ts);
  [organizer integration assertions](../../tests/integration/organizer-invoices.spec.ts) check initial
  revision 0, empty shares/snapshot, retained records, and CLOSED rejection with 409.
- **Validation limit:** State operations have integration evidence; browser treatment of a state change
  made by another client needs a focused two-session E2E check at cutover.

### EC-INV-002 — Assignment, default enrollment, and submission eligibility differ

- **Trigger/actor/state:** A registered participant submits or an organizer changes pool membership.
- **Invariant:** Participant submission requires OPEN and either `assignAll` or an explicit assignment.
  `isDefault` controls enrollment of new registrations; it is not an independent submission permission.
  The locked operation repeats event membership and assignment checks. Removing assignments prunes related
  adjustments and takeover links, including when the remaining membership is empty; it preserves invoice
  history and saved settlements. Existing factors survive assignment updates unless changed; new factors default to 1.
- **Evidence:** [controller eligibility](../../src/controller/eventPoolController.ts),
  [locked submission](../../src/modules/invoice/invoiceOperations.ts),
  [assignment operation](../../src/modules/invoice/poolOperations.ts);
  [workflow assertions](../../tests/integration/invoice-workflows.spec.ts) cover new factor defaults,
  assignment changes, and preserved saved shares. [Assignment browser assertions](../../tests/frontend/invoice-pool-assignments.spec.ts)
  preserve explicit exemptions and factor 0 even with disabled assign-all checkboxes.
- **Validation limit:** Reuse integration membership scenarios; a stale participant form racing removal is
  a server integration boundary, not a reason to trust a hidden submit button.

### EC-INV-003 — Organizer recorder and participant paid-by attribution are independent

- **Trigger/actor/state:** A manager records an expense in OPEN, ORGANIZER_ONLY, or CLOSED.
- **Invariant:** Organizer expenses start APPROVED, need no proof, and need not create an organizer registration.
  The authenticated profile supplies recorder identity; a submitted recorder field cannot impersonate another
  profile. Optional `registrationId` identifies the participant paid by, independently of the recorder.
  Null attribution contributes a shared cost but grants no personal invoice credit or participant ownership,
  even when the recorder also attends. Attribution must name a current assigned event registration.
- **Evidence:** [organizer controller and operation](../../src/controller/eventPoolController.ts),
  [persistOrganizerInvoice](../../src/modules/invoice/invoiceOperations.ts);
  [organizer integration assertions](../../tests/integration/organizer-invoices.spec.ts) explicitly check
  unregistered recorders, ignored forged recorder fields, all three pool states with credit enabled/disabled,
  foreign/unassigned/deleted registrations, and unchanged existing shares.
- **Validation limit:** Existing tests replace email delivery. The corresponding
  [browser attribution assertions](../../tests/frontend/invoice-organizer-attribution.spec.ts) do not prove a live permission transition.

### EC-INV-004 — Attributed ownership and recorder history have separate consequences

- **Trigger/actor/state:** A participant views an organizer-entered attributed invoice, or a recorder is renamed/deleted.
- **Invariant:** The attributed participant may view proof and close the APPROVED invoice through ordinary
  own-invoice actions. Another participant cannot. Recorder identity alone does not grant proof access or
  the self-close action. A manager may use the manager action. The saved recorder name remains useful when
  the profile changes or disappears; it must not be replaced by the paid-by name.
- **Evidence:** [proof policy](../../src/modules/invoice/proofs.ts),
  [invoice presentation](../../src/modules/invoice/presentation.ts);
  [organizer integration assertions](../../tests/integration/organizer-invoices.spec.ts) check attributed
  proof access, 403 for another participant, null-attribution nonownership, manager override, and recorder snapshots.
- **Validation limit:** Preserve the separate fields in contract/component design; use the existing integration
  boundary for authorization and frontend assertions for labels.

## Submission, review, and evidence

### EC-INV-005 — Upload completion does not establish a saved invoice

- **Trigger/actor/state:** A participant uploads mandatory proof with an OPEN-pool invoice.
- **Invariant:** Capture FormData before disabling fields. Show upload progress, then a distinct saving phase;
  100% upload is not success. Repeated initialization/submission must not create concurrent browser requests.
  Slow saving keeps the form locked and warns against resubmission. Confirmed success clears invoice inputs,
  makes history reachable, and retains the chosen pool if it remains eligible. Late callbacks cannot reverse success.
- **Evidence:** [submission module](../../src/public/js/modules/invoice-submission.ts);
  [submission assertions](../../tests/frontend/invoice-submission.spec.ts) inspect captured proof,
  one XHR, disabled fields, the 10-second message, cleared inputs, restored pool, and ignored late callbacks.
- **Validation limit:** The current success transition reloads history after one second. SPA replacement must
  preserve the confirmed/history-refresh semantics while replacing that transport mechanism.

### EC-INV-006 — Ambiguous delivery is not a retryable validation rejection

- **Trigger/actor/state:** Upload or organizer creation receives a network failure, timeout, abort, 5xx, or unexpected HTML.
- **Invariant:** Ambiguous outcomes remain locked and direct the user to history before another upload.
  A definite validation rejection preserves the draft/proof and permits correction. An HTML login response
  with status 200 is not saved-success evidence. Current browser duplicate suppression is not a server
  idempotency contract; no idempotency key or automatic retry guarantee is established by these tests.
- **Evidence:** [participant submission](../../src/public/js/modules/invoice-submission.ts),
  [organizer actions](../../src/public/js/events.ts);
  [submission assertions](../../tests/frontend/invoice-submission.spec.ts) parameterize all five ambiguous
  failures, and [admin UI assertions](../../tests/frontend/invoice-admin-ui.spec.ts) distinguish uncertain
  organizer delivery from definite rejection and corrected retry. The
  [organizer E2E](../../tests/e2e/invoice-organizer-expenses.spec.ts) drops the actual successful response
  through Chromium CDP after the server handles the POST, then asserts one request, a locked submit action,
  history recovery, exactly one saved expense, and accessible proof.
- **Validation limit:** That source-reviewed E2E covers organizer expense creation; it was not executed in
  this review. Equivalent response loss for participant submission and a failed JIT history read after
  confirmed success remain separate gaps. Do not interpret a client timeout as transaction cancellation or
  the organizer test as evidence of server idempotency.

### EC-INV-007 — Invoice status and pool status are separate state machines

- **Trigger/actor/state:** Review, retraction, or own-invoice closure happens before or after pool calculation.
- **Invariant:** Only APPROVED and CLOSED invoices contribute effective costs. Rejecting a NEW invoice keeps
  the record and evidence. Submitter retraction requires NEW, confirmation, and the current revision; RETRACTED
  evidence remains readable. Closing an APPROVED invoice preserves its counted cost and is independent of
  marking a calculated share paid. Closing an already CLOSED invoice is idempotent. Pending NEW invoices may
  still be reviewed after the pool closes; financial changes then mark saved calculations stale.
- **Evidence:** [invoice controller](../../src/controller/eventPoolController.ts),
  [invoice operations](../../src/modules/invoice/invoiceOperations.ts);
  [history assertions](../../tests/integration/invoice-history-changes.spec.ts) cover retraction in OPEN
  and CLOSED, retained proof, unchanged shares/totals, and repeated-retraction rejection;
  [workflow assertions](../../tests/integration/invoice-workflows.spec.ts) check late approval;
  [feedback assertions](../../tests/integration/invoice-admin-feedback.spec.ts) check repeated close with one notice.
- **Validation limit:** Carry both statuses in the UI model. Existing server assertions cover transitions;
  frontend parity must preserve which row action applies to which state.

### EC-INV-008 — Corrections preserve original evidence and reject racing review

- **Trigger/actor/state:** Managers accept with corrections or revise/reject an already counted invoice.
- **Invariant:** Corrections occupy separate fields; original amount, description, and proof survive.
  Null/empty overrides restore original values where parsing allows them. Retroactive changes require explicit
  confirmation and the current revision. Competing review/retraction requests have one winner; a loser must
  not overwrite the result or send another success notification. A CLOSED pool keeps saved shares pending recalculation.
- **Evidence:** [request schemas](../../src/modules/invoice/requests.ts),
  [locked invoice operations](../../src/modules/invoice/invoiceOperations.ts);
  [workflow assertions](../../tests/integration/invoice-workflows.spec.ts) retain original 48.75 while
  counting corrected 44.25; [history assertions](../../tests/integration/invoice-history-changes.spec.ts)
  cover null overrides, confirmation, stale revision, race outcomes, revision increment, and one notification.
- **Validation limit:** Integration race assertions are stronger than sequential button tests; an SPA must
  surface their conflict response without silently replacing a user's unsaved correction.

### EC-INV-009 — Proof access follows current authorization, not knowledge of a URL

- **Trigger/actor/state:** A user follows a retained proof link from any invoice history state.
- **Invariant:** The event/pool/invoice must match. Proof is readable by its attributed participant or an
  effective manager, including managers without event registration. Missing proof or unreadable file gives
  404; unauthorized access gives 403. Path resolution remains within the configured invoice directory.
  Retraction, rejection, and accepted-invoice closure do not themselves destroy proof.
- **Evidence:** [serveInvoiceProof](../../src/controller/eventPoolController.ts),
  [directory and ownership checks](../../src/modules/invoice/proofs.ts);
  [organizer assertions](../../tests/integration/organizer-invoices.spec.ts) verify ownership asymmetries;
  [history assertions](../../tests/integration/invoice-history-changes.spec.ts) retain retracted proof.
- **Validation limit:** These controller assertions do not replace full-route checks for every file/path
  error. Use a narrow route check where the SPA changes proof-link/auth handling.

### EC-INV-010 — Retention removes evidence by event date while preserving saved settlements

- **Trigger/actor/state:** The invoice retention job selects an event whose end date is at or before the cutoff.
- **Invariant:** The cutoff is a calendar date derived by subtracting configured months, not invoice age or
  invoice status. Selected invoice rows/proofs are removed independently of archival. File deletion is
  bounded and best effort; selected rows can still be removed when files are missing. Pool-locked deletion
  advances revision and refreshes current totals while leaving saved shares and numeric provenance intact.
- **Evidence:** [retention orchestration](../../src/modules/invoice/retention.ts),
  [getExpiredInvoices](../../src/modules/database/services/EventInvoiceService.ts);
  [retention integration assertion](../../tests/integration/invoice-workflows.spec.ts) checks an expired
  event's row and proof disappear while a later event's row and proof remain.
- **Validation limit:** That assertion does not establish atomicity between filesystem and SQL or simulate
  every partial failure. Retention means a previously rendered proof link can legitimately become unavailable.

## Calculation, concurrency, and signed amounts

### EC-INV-011 — Preview is read-only and revision-bound

- **Trigger/actor/state:** A manager previews close/recalculation while another actor edits inputs or records payment.
- **Invariant:** Preview changes no shares, payment markers, revision, totals, or `closedAt`, and sends no mail.
  Apply rechecks revision under the pool lock. A payment changes revision even when no recalculation is needed;
  therefore it also invalidates an earlier preview. Failure preserves newly saved payment/share IDs and stale flags.
  A fresh unchanged preview and commit project the same signed component amounts.
- **Evidence:** [preview and close orchestration](../../src/controller/eventPoolController.ts),
  [commit operation](../../src/modules/invoice/poolOperations.ts),
  [repeatable reads and root lock](../../src/modules/database/services/EventInvoiceService.ts);
  [workflow assertions](../../tests/integration/invoice-workflows.spec.ts) explicitly compare before/after
  preview, projected/committed amounts, stale shares, and payment-after-preview rejection.
- **Validation limit:** These are integration assertions; two independently open browser previews remain
  a focused E2E gap. Do not substitute an entity timestamp for the pool's calculation revision.

### EC-INV-012 — Confirmation and revision requirements are command-specific

- **Trigger/actor/state:** A client serializes a confirmation, revision, or optional email choice.
- **Invariant:** Submission-state change requires revision; retroactive invoice changes require revision and
  confirmation. Calculate/notify/rollback parsing accepts an optional expected revision; the calculation
  orchestration still passes its loaded revision to locked commit. Payment marking does not currently
  accept the same confirmed/revision payload as retroactive invoice correction. Browser acknowledgement
  alone must not be mistaken for a server field shared by every endpoint.
- **Evidence:** [request definitions](../../src/modules/invoice/requests.ts),
  [controller commands](../../src/controller/eventPoolController.ts);
  [request assertions](../../tests/unit/invoice-requests.spec.ts) and
  [admin payload assertions](../../tests/frontend/invoice-admin-ui.spec.ts) exercise relevant shapes.
- **Validation limit:** Keep command-specific contract tests when standardizing transport. Uniform UI
  components do not authorize changing these server preconditions as part of a parity migration.

### EC-INV-013 — Invalid or unsaved preview data cannot enable apply

- **Trigger/actor/state:** A dialog contains local edits or receives a malformed/stale preview payload.
- **Invariant:** Unsaved form edits must be saved or discarded before requesting calculation from saved data.
  Invalid revision, nonfinite/empty money, or incomplete reconciliation data prevents apply. Reusing the
  dialog clears old rows/totals/optional columns. Optional columns depend on nonzero row values, even when
  their grand total cancels to zero. Notes and names remain text, not executable markup.
- **Evidence:** [browser preview](../../src/public/js/events.ts),
  [pool dialogs](../../src/views/modules/module_invoice_pool.pug);
  [preview assertions](../../tests/frontend/invoice-calculation-preview.spec.ts) check invalid revisions,
  amounts, reconciliation, cleared content, cancelling totals, escaped labels, and private payer detail.
- **Validation limit:** Browser helper assertions do not prove polling preserves a dirty real form; preserve
  that boundary in the SPA's focused dialog test.

### EC-INV-014 — Zero weight, exemption, and attendance are not interchangeable

- **Trigger/actor/state:** A manager assigns factor 0, exempts a participant, or selects EQUAL/DAYS/NIGHTS.
- **Invariant:** Factors are finite, 0–1000, with at most four decimal places; 0 is valid. EQUAL uses one unit,
  DAYS includes both endpoints, and NIGHTS uses their date difference. Exemption excludes base distribution
  without inventing different factual attendance or erasing applicable personal components. A nonzero total
  with no positive weight fails; a zero total with no participants is valid.
- **Evidence:** [calculation](../../src/modules/invoice/calculation.ts),
  [factor validation and distribution](../../src/modules/invoice/distribution.ts);
  [distribution assertions](../../tests/unit/invoice-distribution.spec.ts) check zero factor/no denominator,
  invalid precision, and extreme valid factors; [settlement assertions](../../tests/unit/invoice-settlements.spec.ts)
  preserve factual attendance for exempt participants.
- **Validation limit:** Numeric unit evidence is sufficient for arithmetic; browser controls must retain
  meaningful zero values instead of replacing them with defaults.

### EC-INV-015 — Per-person rounding intentionally permits a reconciliation delta

- **Trigger/actor/state:** Weighted amounts have fractional cents, including negative distributable totals.
- **Invariant:** Round each beneficiary's base before grouping by payer. Default upward rounding is
  mathematical ceiling; downward rounding is floor, including negative amounts. Do not distribute spare
  cents by registration order. Therefore two equal shares of 0.01 can total 0.02; the difference is visible
  accounting information. Changing rounding invalidates preview, and an omitted setting preserves its saved value.
- **Evidence:** [exact decimal distribution](../../src/modules/invoice/distribution.ts),
  [payer grouping](../../src/modules/invoice/calculation.ts);
  [unit assertions](../../tests/unit/invoice-distribution.spec.ts) check ±100/3, order independence, and
  0.01 splits; [workflow assertions](../../tests/integration/invoice-workflows.spec.ts) cover saved rounding;
  [large-roster E2E assertions](../../tests/e2e/invoice-pools.spec.ts) expect visible -0.12 and +0.16 deltas.
- **Validation limit:** Preserve the established arithmetic in shared presentation; formatting in a new locale
  must not change values or hide the sign of the rounding difference.

### EC-INV-016 — Redistributed and additional adjustments have different arithmetic

- **Trigger/actor/state:** A manager adds a signed surcharge/rebate with an explanation.
- **Invariant:** A redistributed adjustment is subtracted from the distributable pool base and then applied
  to its assigned participant; an additional adjustment changes that participant's amount without reducing
  the base. Negative rebates remain signed and totals are not clamped to zero. Gross adjustment categories
  remain explainable when positives/negatives cancel. Participant invoice credits use effective approved
  values only when enabled, and null-attributed organizer costs never produce personal credit.
- **Evidence:** [calculation](../../src/modules/invoice/calculation.ts),
  [request parsing](../../src/modules/invoice/requests.ts);
  [workflow assertions](../../tests/integration/invoice-workflows.spec.ts) combine weights, signed rebates,
  credits, and coverage; [email presentation assertions](../../tests/unit/invoice-settlement-email.spec.ts)
  preserve offsetting categories and signed previously settled refunds.
- **Validation limit:** Unit/integration arithmetic evidence does not prove the new UI's explanatory labels;
  compare each component rather than only the final total.

### EC-INV-017 — Recalculation carries signed transfers once, on the actual payer

- **Trigger/actor/state:** A paid/refunded share is recalculated repeatedly or its responsibility is reassigned.
- **Invariant:** Credit equals previously carried credit plus the signed current share only when that share
  is marked paid. A date alone creates no credit. New remaining balance is base + adjustments − invoice
  credit − payment credit. Recorded refunds remain negative credits. A takeover moves future responsibility,
  not another payer's historical payment. Repeated calculation must not count a transfer twice.
- **Evidence:** [settlement projection](../../src/modules/invoice/settlements.ts);
  [unit assertions](../../tests/unit/invoice-settlements.spec.ts) cover signed credit, zero/dates, partial
  consumption, grouped historical rows, and original-payer retention;
  [workflow assertions](../../tests/integration/invoice-workflows.spec.ts) cover repeated recalculation and refunds.
- **Validation limit:** The existing tests are numeric/integration evidence. A display-only refresh must not
  rewrite these persisted components or infer a transfer from a formatted status label.

### EC-INV-018 — Former payers may remain solely to receive a correction

- **Trigger/actor/state:** A payer loses all current allocations after having paid or received money.
- **Invariant:** While the registration exists, nonzero outstanding carried credit produces a corrective
  share even with no current base allocation. Once an opposite transfer exactly consumes that credit, the
  credit-only row disappears. An actually allocated zero share remains a normal row. Hard-deleted registration
  IDs are filtered out; the implementation does not resurrect participants from payment history.
- **Evidence:** [settlement projection](../../src/modules/invoice/settlements.ts);
  [unit assertions](../../tests/unit/invoice-settlements.spec.ts) check paid refund/repayment disappearance,
  partial correction, allocated zero rows, and hard-deleted registrations;
  [workflow assertions](../../tests/integration/invoice-workflows.spec.ts) check all allocations removed.
- **Validation limit:** This is an intentional persistence boundary, not permission for a frontend to hide
  an existing corrective row. Preserve it in list, totals, email, and export presentation.

### EC-INV-019 — Payment status changes do not erase the calculated balance

- **Trigger/actor/state:** A manager marks a positive payment or negative refund settled, then undoes the marker.
- **Invariant:** In CLOSED pools the operation changes `isPaid`/`paidAt`, not signed `shareAmount`. Paid/refunded
  status changes outstanding totals without replacing the saved amount with zero. Undo affects the current
  recorded marker, not older carried payments. A naturally zero remainder needs no payment.
- **Evidence:** [recordShareSettlement](../../src/modules/invoice/poolOperations.ts),
  [presentation](../../src/modules/invoice/presentation.ts);
  [admin UI assertions](../../tests/frontend/invoice-admin-ui.spec.ts) distinguish payment/refund actions
  and immutable amounts; [workflow assertions](../../tests/integration/invoice-workflows.spec.ts) cover carry-forward/undo.
- **Validation limit:** Settlement UI confirmation and pending-state tests exist; a stale preview must still
  be invalidated even though this operation leaves `needsRecalculation` false.

## Coverage, saved evidence, and rollback

### EC-INV-020 — Participant coverage is restricted to OPEN and one level

- **Trigger/actor/state:** A participant chooses whom to cover, or a manager reassigns coverage.
- **Invariant:** Participants can edit their own payer relationship only while OPEN; ORGANIZER_ONLY also
  blocks self-service coverage. A covered participant cannot become a payer; self-links, chains, and taking
  someone already covered by another payer are rejected. A manager may reassign current eligible members.
  Locked validation repeats membership/ownership checks. An unchanged set creates no revision or notification delta.
- **Evidence:** [takeover preparation](../../src/modules/invoice/requests.ts),
  [locked takeover operation](../../src/modules/invoice/takeovers.ts);
  [workflow assertions](../../tests/integration/invoice-workflows.spec.ts) check organizer-only blocking,
  closed participant rejection, planning notices, and unchanged/repeated assignments.
- **Validation limit:** Preserve the server rule even if the new UI hides the control; conflicting simultaneous
  changes need integration validation if the mutation transport changes.

### EC-INV-021 — Pending coverage must not masquerade as applied settlement responsibility

- **Trigger/actor/state:** A manager edits coverage after CLOSED, including remove/re-add/reassign sequences.
- **Invariant:** Edits change pending inputs and mark recalculation needed while preserving saved shares and
  applied snapshot. On successful recalculation, notices describe only the final applied delta after commit.
  Intermediate edits, rollback, unchanged recalculation, and remove/re-add with no net change send no coverage
  notice. Coverage notices are independent of the optional general calculation-email preference.
- **Evidence:** [takeover orchestration](../../src/controller/eventPoolController.ts),
  [applied evidence](../../src/modules/invoice/coverage.ts),
  [calculation commit](../../src/modules/invoice/poolOperations.ts);
  [workflow assertions](../../tests/integration/invoice-workflows.spec.ts) observe committed state at the
  email boundary, final recipients, no repeated notices, and stale-preview rejection;
  [E2E assertions](../../tests/e2e/invoice-pools.spec.ts) distinguish applied rows and pending notices.
- **Validation limit:** Preserve both data sets in the SPA; replacing applied labels from editable inputs
  would contradict the saved ledger even before any amount changes.

### EC-INV-022 — Old snapshots cannot supply facts they never recorded

- **Trigger/actor/state:** An existing installation has a missing snapshot or older numeric evidence.
- **Invariant:** Applied coverage may be recovered from frozen contribution attribution when explicit
  takeover evidence is absent. When neither source exists, show unknown historical coverage; do not infer
  it from today's pending links or parse saved prose. First recalculation establishes evidence without
  speculative historic-change notices. Missing saved rounding evidence retains the legacy fallback and stale status.
- **Evidence:** [coverage fallback](../../src/modules/invoice/coverage.ts),
  [presentation](../../src/modules/invoice/presentation.ts),
  [rollback fallback](../../src/modules/invoice/poolOperations.ts);
  [workflow assertions](../../tests/integration/invoice-workflows.spec.ts) cover no snapshot, frozen
  attribution fallback, and unknown coverage; [email assertions](../../tests/unit/invoice-settlement-email.spec.ts)
  preserve old notes without inventing attendance numbers.
- **Validation limit:** Keep legacy fixtures in unit/integration coverage. A new complete DTO must represent
  absent historical evidence instead of filling it with present-day values.

### EC-INV-023 — Rollback restores pool inputs, not external facts or transfers

- **Trigger/actor/state:** A manager rolls a CLOSED pool back to the last calculated input snapshot.
- **Invariant:** Restore local settings, valid assignments/factors/exemptions, adjustments, and applied
  coverage. Keep current shares, paid markers, invoices, attendance, and saved numeric explanation. External
  registration/invoice changes keep the pool stale. Deleted registrations are filtered; a default pool retains
  registrations added after the snapshot at factor 1. Require supported saved evidence and reject a supplied
  stale revision. Rollback sends no notifications and does not reopen the pool.
- **Evidence:** [restorePoolCalculationInputs](../../src/modules/invoice/poolOperations.ts);
  [workflow assertions](../../tests/integration/invoice-workflows.spec.ts) compare saved shares/payment
  markers, restored flags/rounding/factors, external attendance/approved invoices, unchanged explanation,
  and no email; [organizer assertions](../../tests/integration/organizer-invoices.spec.ts) retain late costs.
- **Validation limit:** Existing assertions strongly cover local versus external state; they do not prove
  a filesystem rollback, which this action does not perform.

## Notifications, exports, and review limits

### EC-INV-024 — Persistence success and email delivery success are separate

- **Trigger/actor/state:** Submission, review, calculation, or a coverage change triggers email.
- **Invariant:** A saved invoice remains saved when mail fails; submission receipt delivery does not block
  the response. Only the winning review transition sends its notice. Calculation uses the saved email
  preference unless a one-time request override is supplied; the override does not change the preference.
  Organizer expense creation sends no participant-submission receipt. Do not retry a financial mutation
  simply because its notification failed.
- **Evidence:** [notifications](../../src/modules/invoice/notifications.ts),
  [controller](../../src/controller/eventPoolController.ts);
  [workflow assertions](../../tests/integration/invoice-workflows.spec.ts) keep submission responsive to a
  pending mail promise and check both override directions;
  [feedback assertions](../../tests/integration/invoice-admin-feedback.spec.ts) preserve approval after mail rejection.
- **Validation limit:** Tests replace the external email sender. They establish invocation/state behavior,
  not successful delivery to a mailbox or an exactly-once external delivery guarantee.

### EC-INV-025 — Resend uses the saved ledger even when new inputs are pending

- **Trigger/actor/state:** A manager resends settlement information for a CLOSED stale pool.
- **Invariant:** Resend reports saved balances, settled statuses, previous signed transfers, and saved
  explanation; it neither calculates pending inputs nor clears stale state or payment markers. A supplied
  stale revision rejects before mail. Missing recipient addresses do not become invented deliveries.
- **Evidence:** [notifyPoolShares](../../src/controller/eventPoolController.ts),
  [settlement email presentation](../../src/modules/invoice/settlementEmail.ts);
  [workflow assertions](../../tests/integration/invoice-workflows.spec.ts) compare shares/revision before
  and after resend and distinguish a saved paid 50.00 from a later recalculated 25.00 remainder.
- **Validation limit:** A successful count is an application notification result, not delivery confirmation;
  keep resend distinct from apply-recalculation in the UI.

### EC-INV-026 — PDF exports show saved amounts and retain their own authorization

- **Trigger/actor/state:** A manager downloads shares with or without the optional worked example.
- **Invariant:** Export requires a CLOSED pool and the authorized matching event. It serves a no-store PDF
  download, preserves signed amounts and settled statuses, and labels stale saved calculations. Omitting the
  example does not omit cost facts, rows, or notes. Paid values remain visible; refunds remain negative.
  Unused optional columns disappear, long names/notes wrap without truncation, and empty saved shares have an explicit state.
- **Evidence:** [export data controller](../../src/controller/eventPoolController.ts),
  [PDF definition](../../src/modules/invoice/exports.ts);
  [PDF unit assertions](../../tests/unit/invoice-shares-pdf.spec.ts) inspect A4 widths, signed cells, stale
  text, wrapping, and unchanged inputs; [E2E assertions](../../tests/e2e/invoice-pools.spec.ts) check PDF
  signature/content type, no-store, both downloads, filename, 409 before closure, 403, mismatched-event 404, and bad query 400.
- **Validation limit:** Those checks do not visually inspect generated multipage PDFs or verify every font/glyph.
  A focused rendered-PDF review is appropriate when export layout or localization changes.

### EC-INV-027 — Shared ledger components must retain personal scope and local-list semantics

- **Trigger/actor/state:** A participant opens their calculation details or a manager filters/pages a large ledger.
- **Invariant:** Personal details show only the selected actual payer and covered contributions. Reusing a
  dialog must clear the previous person's details. Filtering/sorting/paging affects existing rows; the current
  Refresh list action is not evidence of a server refetch. Zero/paid/refund rows and empty filtered results
  remain distinguishable. Confirmation cancellation restores focus without issuing a mutation.
- **Evidence:** [browser ledger/dialog behavior](../../src/public/js/events.ts),
  [pool view](../../src/views/modules/module_invoice_pool.pug);
  [admin UI assertions](../../tests/frontend/invoice-admin-ui.spec.ts) check selected-row details/text
  nodes, local filters, paging, cancellation, pending actions, and signed settlement controls;
  [large-ledger E2E assertions](../../tests/e2e/invoice-pools.spec.ts) check 25-row pages and visible actions.
- **Validation limit:** SPA polling is new behavior to validate separately; existing Refresh list tests
  must not be cited as evidence of concurrent-client freshness.

## Registered defects and reconciliation notes

The [defect register](../backlog/documentation-remediation.yml) remains the single register for implementation defects.
IMP-013 is relevant to upload/deletion cleanup and must not become a preservation invariant. Organizer rejected-proof
cleanup has explicit integration evidence; that does not establish equivalent cleanup for every participant failure.

At this source baseline, the executable paths reviewed for EC-INV-002, EC-INV-009, and EC-INV-020 appear to
supersede the old descriptions in IMP-011, IMP-012, IMP-014, and IMP-015: current proof authorization accepts
effective managers, default status is not independent submission eligibility, participant takeover writes require
OPEN inside the lock, and assignment pruning handles an empty member set. These entries require register
reconciliation; this document does not silently close them or preserve their former defects as intentional exceptions.

This invoice-specific source review changed no runtime file, database, test, or remediation-register entry. The main remaining
validation boundaries are real two-client stale-form handling, participant response loss after a committed upload,
failed JIT history reads after confirmed success, external email delivery, and visual generated-PDF layout.
The existing organizer E2E already covers a committed expense whose response is lost. Existing assertion evidence should be reused before adding a
more expensive test layer.
