# Invoice Pools and Payments
<!--
documentation-metadata
audience: event participants; event organizers
owner: event invoice-pool maintainers
status: current
last-verified: 2026-09-05
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: D06 pool creation, assignment, takeover, surcharge, invoice submission, proof, review, correction, closure, recalculation, share, payment-status, notification, privacy, storage, and retention workflows verified; D14 rendered help navigation, semantic checks, and trusted-content integration
source-anchors: src/routes/api/eventInvoices.ts; src/controller/eventPoolController.ts; src/modules/database/services/EventInvoiceService.ts; src/modules/database/entities/event/EventInvoice.ts; src/modules/database/entities/event/EventInvoicePool.ts; src/modules/database/entities/event/EventInvoiceShare.ts; src/modules/database/entities/event/EventInvoiceSurcharge.ts; src/modules/database/entities/event/EventPoolAssignment.ts; src/modules/database/entities/event/EventPoolTakeover.ts; src/views/modules/module_invoice_pool.pug; src/views/event/event-view.pug; src/views/event/event-dashboard.pug; src/public/js/events.ts; src/modules/invoiceRetention.ts; src/modules/lib/fileCommons.ts; tests/integration/invoice-workflows.spec.ts; tests/frontend/ui-behaviors.spec.ts; src/controller/helpController.ts; tests/unit/help-documentation.spec.ts
next-review: invoice-pool-visible-UI-or-behavior-change
-->

Invoice pools help an event group collect receipts, decide which costs count, and calculate who owes or is owed money. Surveyor records the calculation and settlement status; it does not collect money or initiate bank transfers.

## Choose your task

### Participant

- [Submit an invoice](#submit-an-invoice)
- [Check an invoice or close an accepted invoice](#check-your-invoice-history)
- [Pay for another participant](#choose-whose-share-you-will-cover)
- [Understand your final share](#understand-your-final-share)

### Organizer

- [Create an invoice pool](#create-an-invoice-pool)
- [Choose participants and exemptions](#choose-participants-and-exemptions)
- [Manage takeovers](#manage-takeovers-for-the-group)
- [Add a participant-specific surcharge](#add-a-surcharge)
- [Review, correct, accept, or reject invoices](#review-submitted-invoices)
- [Close a pool and calculate shares](#close-the-pool-and-calculate-shares)
- [Correct a closed pool](#recalculate-a-closed-pool)
- [Record settlement](#record-whether-a-share-is-settled)

## First understand the two kinds of status

An invoice and its pool have separate lifecycles. **Closed invoice** and **closed pool** do not mean the same thing.

### Pool status

| Pool status | Meaning | Available work |
|---|---|---|
| **OPEN** | Costs and allocation rules are still being collected. No final shares have been frozen. | Assigned participants can submit invoices and manage their own takeovers. Organizers can change settings, assignments, exemptions, takeovers, and surcharges, and can review invoices. |
| **CLOSED** | Surveyor has generated one final share per payer from the current accepted costs and allocation rules. | Participants can see their shares. Organizers can record settlement. Settings can be corrected, but the shares change only after **Recalculate pool**. New invoices cannot be submitted. |

Closing a pool does not delete it, and there is no ordinary **Reopen pool** or **Delete pool** control. **Recalculate pool** replaces the shares and leaves the pool closed again.

### Invoice status

| Visible status | How it starts | What happens next | Included in pool costs? |
|---|---|---|---|
| **Awaiting review** | An assigned participant submits an invoice and proof to an open pool. | An organizer can **Accept** it, optionally with a correction, or **Reject** it with a reason. | No. |
| **Accepted** | An organizer accepts an awaiting-review invoice. | The submitter or an organizer can **Close** it. | Yes, using the accepted corrected amount when one exists. |
| **Rejected** | An organizer rejects an awaiting-review invoice. | The invoice remains in the submitter’s history. Submit a new invoice if a replacement is needed and the pool is still open. | No. |
| **Closed** | The submitter or an organizer closes an accepted invoice. | No further invoice action is shown. The invoice remains in history. | Yes. |

Closing an accepted invoice means that its review record is finished. It does **not** remove the cost, mark anyone’s share as paid, or close the pool. The organizer’s **Open invoices** total contains accepted invoices that have not yet been closed; both Accepted and Closed invoices remain in **Total invoices**.

## Who can use invoice-pool controls

### Participants

You can use the participant tools when all of the following are true:

1. You are registered for the event with the active profile.
2. The organizer assigned your registration to the pool, or the pool applies to all participants.
3. The pool is open for submission or takeover changes.

A participant can submit only their own invoice, change only the takeovers for which they are the payer, view only their own invoice history and proof, close only their own accepted invoice, and view only their own final share.

### Organizers

The event owner receives all event permissions. Another organizer needs:

- **Access Admin** to open **Event administration dashboard**.
- **Manage Assignments** to see and operate **Invoice pools**, including all invoices, proofs, assignments, takeovers, surcharges, shares, and settlement controls.

Grant **Manage Assignments** only to trusted organizers. Invoice descriptions and proofs can contain names, addresses, account details, purchase information, or other sensitive data. See [Permissions and Sharing](PERMISSIONS.md#delegate-a-limited-organizer) before delegating this work.

## Participant tasks

### Submit an invoice

Use this task when you paid an expense that should be considered in an event cost pool.

1. Open the event with the profile that is registered for it.
2. Open **Invoice pools & payments**.
3. Open **Submit an invoice & history**.
4. Under **Choose pool**, select the open pool for this cost.
5. Enter a positive **Amount**. The smallest value accepted by the form is `0.01`.
6. Enter an optional **Description** that helps the organizer identify the cost.
7. Under **Proof (image or PDF)**, select one proof file.
8. Select **Submit invoice**.

The proof is required. Surveyor accepts JPEG, PNG, GIF, or PDF files up to 10 MiB. Use a clear receipt, invoice, or payment record, but include only the personal and financial information needed for the organizer to verify the cost.

After a successful submission:

- The invoice appears immediately in **Your invoice history** as **Awaiting review**.
- Surveyor assigns it an invoice number.
- The organizer can view the submitted amount, description, and proof.
- Surveyor sends **Invoice submitted** to the email address attached to your account or guest profile, when an address is available and email delivery is configured.

Surveyor does not notify organizers by email about each new submission. They review new entries in **Invoice administration**.

#### No open pool is available

**No open pools for submissions right now.** means that you are not assigned to an open pool. Confirm that you are using the registered profile, then ask an organizer whether the pool is closed or your registration needs to be assigned.

### Check your invoice history

Open **Invoice pools & payments** → **Submit an invoice & history**. **Your invoice history** shows all invoices submitted by the active registration, including invoices from pools that are now closed.

For each invoice you can see:

- Invoice number and submission date.
- Pool name.
- Current or corrected amount.
- Current or corrected description.
- Status and any rejection reason.
- **View proof**.
- **Close**, only while the invoice is Accepted.

The original amount remains visible when an organizer accepted a corrected amount. The original description remains visible when an organizer accepted a corrected description.

Use **Search invoices** to search the invoice number, pool, amount, description, correction, or rejection reason. Use **All statuses** to show only Awaiting review, Accepted, Rejected, or Closed entries. Choose 25, 50, or 100 rows per page and use **Previous** or **Next** for a longer history.

#### What to do for each status

- **Awaiting review:** wait for an organizer. You cannot edit or delete the submission.
- **Accepted:** review any correction. Select **Close** when the accepted invoice needs no further review discussion.
- **Rejected:** read the reason. Contact an organizer when clarification is needed, then submit a replacement while the pool is open. The rejected record and proof remain in history.
- **Closed:** no further invoice action is required. The cost remains included in pool totals.

When your profile has an email address, Surveyor sends a message when an organizer accepts, rejects, or closes the invoice. The acceptance email states the effective accepted amount and any organizer correction. The rejection email includes the reason.

### Choose whose share you will cover

A takeover means that one participant, the **payer**, accepts the final share of another participant, the **beneficiary**. The beneficiary will not receive a separate share; their base amount, surcharges, and invoice credit are combined into the payer’s result.

To set your own takeovers before the pool closes:

1. Open **Invoice pools & payments**.
2. Find **Takeovers** and the open pool.
3. Select **Manage takeovers**.
4. Search for or select each participant whose share you will cover.
5. Select **Save changes**.

Rules:

- You cannot cover yourself.
- One beneficiary can have only one payer.
- A participant whose share is already covered cannot also cover somebody else.
- You cannot replace another payer’s existing claim yourself; ask an organizer to reassign it.
- Only people assigned to the same pool can be selected.
- Participant takeover controls are available only while the pool is open.

The current coverage relationships are shown in the pool. When email addresses are available, Surveyor emails both the payer and beneficiary after a takeover is added or removed and identifies who made the change.

A takeover is a calculation instruction, not a payment. It takes effect when the organizer closes or recalculates the pool.

### Understand your final share

After the organizer closes a pool, **Your pool shares** shows the row assigned to you as payer.

| Column | Meaning |
|---|---|
| **Base** | Your automatic portion of the distributable invoice total, plus the automatic portions of people you cover. |
| **Surcharges** | Participant-specific charges assigned to you or to people you cover. |
| **Invoice credit** | Accepted invoices submitted by you or people you cover when **Deduct submitter invoices from their share** is enabled. |
| **Total** | `Base + Surcharges - Invoice credit`. |
| **Notes** | Calculation details, including attendance weight, exemptions, takeovers, surcharges, and credits. |
| **Status** | **Outstanding** until an organizer records the share as **Paid**; it can later be returned to Outstanding. |

A positive Total is an amount the payer owes. A negative Total is a credit that the group owes to the payer. Zero means that no net settlement is due.

**Paid** is only a manual settlement marker. Surveyor does not charge a card, send a transfer, or prove that money changed hands. For a negative share, Paid means the credit has been settled with the participant.

When the pool closes, Surveyor emails each payer who has an email address. The message states the amount due or owed, the people covered, and a calculation breakdown. A later change to Paid or Outstanding also generates an email when an address is available.

## Organizer tasks

### Create an invoice pool

1. Open the event.
2. Select **Event administration dashboard**.
3. Find **Invoice pools**.
4. Select **Create pool**.
5. Complete **Create a new pool**.
6. Select **Add pool**.

#### Creation fields

| Field | Purpose |
|---|---|
| **Pool name** | Required name, up to 255 characters. Choose a name participants can recognize in the submission list. |
| **Share distribution mode** | Chooses how the distributable total is divided when the pool closes. |
| **Description** | Optional explanation of which expenses belong in the pool. |
| **Assign to all participants** | Includes every current and future event registration. This is selected initially. |
| **Make this the default pool** | Automatically assigns each future event registration while allowing the organizer to choose the current participants separately. |
| **Deduct submitter invoices from their share** | Credits a participant’s accepted invoices against the final share of that participant or their covering payer. This is selected initially. |
| **Limit to participants** | Selects current registrations when **Assign to all participants** is off. |

The pool starts as **OPEN**. Its name cannot be edited through the current pool-settings form, so choose it carefully. The description and distribution mode can be changed later with **Save base settings**.

#### Distribution modes

| Visible choice | Calculation |
|---|---|
| **Distribute among participants** | Divides the distributable total equally among non-exempt assigned participants. |
| **Distribute among days attended** | Weights the total by each non-exempt participant’s attendance days, counting both the arrival and departure dates. |
| **Distribute among nights stayed** | Weights the total by the number of nights between arrival and departure. A same-day registration contributes zero nights. |

Check participant attendance dates before using days or nights. A later attendance correction changes the result only after the pool is first closed or explicitly recalculated.

### Understand the pool totals

The organizer view shows several different totals. They answer different questions.

| Display | What it contains |
|---|---|
| **Total invoices** | Effective amounts of Accepted and Closed invoices. Awaiting-review and Rejected invoices are excluded. |
| **Open invoices** | Effective amounts of Accepted invoices that have not been individually closed. |
| **Extra charges** | Surcharges that are added on top of invoice costs. |
| **Surcharges reducing pool** | Surcharges earmarked to one participant while removing the same amount from the shared distribution. |
| **Distributable total** | Total invoices minus offsetting surcharges, never below zero. |
| **Full total** | Total invoices plus extra-only surcharges. |
| **Outstanding payments** | Positive shares not marked Paid. |
| **Credits owed to participants** | Absolute value of negative shares not marked Paid. |

Pool totals update as invoices are reviewed, surcharges change, and settlement markers change. In a closed pool, these headline totals can reflect a later review or adjustment while the previously generated share rows remain frozen until **Recalculate pool**.

### Choose participants and exemptions

Open a pool and use **Update assignment**.

1. Select or clear **Assign to all participants**.
2. Select or clear **Default for new participants**.
3. Select or clear **Deduct submitter invoices from their share**.
4. Use **Search participants** when the event has a long registration list.
5. Select each included registration when the pool is not assigned to all.
6. Select **Exempt** where appropriate.
7. Select **Save assignments** while the pool is open.

The two automatic assignment switches are different:

- **Assign to all participants** makes the pool apply to every event registration, including registrations created later.
- **Default for new participants** adds future registrations automatically but does not force every existing registration into the pool.

An exempt participant remains assigned to the pool but receives no automatic Base amount. They can still have a surcharge, an invoice credit, or a takeover relationship. Their final result can therefore be positive, zero, or negative.

Removing a participant from an open pool also removes incompatible takeovers and surcharges for registrations no longer in the pool. Review the adjustment list after changing the assignment scope.

For a closed pool, edit the displayed choices and use **Recalculate pool**. **Save assignments** is not available because changing the inputs alone must not alter already generated shares.

### Manage takeovers for the group

An organizer can establish or reassign coverage for any payer in the pool.

1. Open the pool.
2. Under **Takeovers**, select **Manage takeovers**.
3. Choose the **Payer**.
4. Use **Search participants** if needed.
5. Select the beneficiaries this payer covers.
6. Select **Save changes**.

The same rules apply as in participant self-service: no self-coverage, one payer per beneficiary, and a covered participant cannot cover somebody else. Organizer reassignment removes the previous payer’s mapping and creates the new one.

Changes send **Invoice takeovers updated** to affected payers and beneficiaries when their profiles have email addresses. The message names the event, pool, actor, and added or removed coverage.

If takeover configuration is corrected after the pool has closed, the existing shares remain unchanged until **Recalculate pool**.

### Add a surcharge

Use **Manual surcharge assignment** for a positive participant-specific amount that should not be divided in the ordinary way.

1. Select the **Participant**.
2. Enter a positive **Amount**.
3. Enter a required **Note** explaining the charge.
4. Decide whether **Subtract from pool** applies.
5. Select **Add surcharge**.

The two surcharge modes behave differently:

- **Subtract from pool** selected: the participant or covering payer receives the surcharge, and the same amount is removed from the shared distributable total. The list labels it **Offsets pool total**.
- **Subtract from pool** cleared: the surcharge is added on top of the invoice costs for that participant or covering payer. The list labels it **Extra charge only**.

Use **Remove** to delete an incorrect surcharge. The note is shown in share details, so write it for the participant who will read the final calculation.

In a closed pool, assignment or surcharge corrections affect the final shares only when submitted through **Recalculate pool**. Review all adjustments before recalculating.

### Review submitted invoices

Each pool contains **Invoice administration**. Newest submissions appear first.

Use:

- **Search invoices** to search invoice number, participant name or email, amounts, descriptions, corrections, or rejection reasons.
- **All statuses** to filter Awaiting review, Accepted, Rejected, or Closed invoices.
- 25, 50, or 100 rows per page.
- **Previous** and **Next** to move through longer ledgers.

For each submission, compare **Submitted details** with **View proof**. The **Organizer review** column contains the correction and rejection fields while the invoice is Awaiting review.

#### Accept without correction

1. Leave **Corrected amount** empty.
2. Leave **Corrected description** empty.
3. Select **Accept**.

The submitted amount and description become the effective accepted values.

#### Accept with a correction

1. Enter a positive **Corrected amount** when the accepted total differs from the submitted amount.
2. Enter a **Corrected description** when the accepted explanation should differ. It can contain up to 4,000 characters.
3. Select **Accept**.

Surveyor preserves the original submission and displays it beside the correction. The corrected amount is used for pool totals, invoice credit, and final shares. A blank corrected field keeps the corresponding submitted value.

#### Reject

1. Enter a **Rejection reason**. It is required and can contain up to 4,000 characters.
2. Select **Reject**.

The invoice becomes Rejected. It is excluded from totals but remains in both the organizer ledger and the submitter’s history with the reason and proof.

#### Close an accepted invoice

Select **Close** on an Accepted invoice when its review record is finished. The invoice becomes Closed but remains included in **Total invoices** and in the final share calculation. The action does not settle a participant share.

The submitter may also close their own Accepted invoice from **Your invoice history**.

#### Notifications and late review

When the submitter has an email address, Surveyor sends an acceptance, rejection, or closure message with the organizer’s displayed actor label. Review actions remain available for an Awaiting-review invoice even if the pool has already been closed. Accepting a cost after pool closure requires **Recalculate pool** before the new cost is represented in the frozen shares.

Resolve or consciously exclude every Awaiting-review invoice before closing the pool whenever possible. Closing a pool ignores Awaiting-review and Rejected invoices.

### Close the pool and calculate shares

Before selecting **Close pool**, verify:

1. Every intended participant is assigned.
2. Attendance dates are correct for days or nights distribution.
3. Exemptions are correct.
4. Takeovers are correct.
5. Surcharges and their offset mode are correct.
6. Every intended invoice is Accepted or Closed.
7. **Deduct submitter invoices from their share** has the intended setting.

Then:

1. Open the pool’s **Danger zone**.
2. Select **Close pool**.
3. Confirm the warning.

At least one participant must be assigned. Surveyor then:

- Selects Accepted and Closed invoices and ignores Awaiting-review and Rejected invoices.
- Calculates the distributable total after offsetting surcharges.
- Divides the Base amount by participants, inclusive attendance days, or nights.
- Gives exempt participants no automatic Base amount.
- Adds participant-specific surcharges.
- Applies invoice credits when enabled.
- Combines beneficiaries into their covering payer.
- Creates one share row for each resulting payer.
- Sets every new share to Outstanding.
- Marks the pool CLOSED.
- Emails each payer who has an email address with the amount due or owed and the calculation details.

The final formula for each payer is:

```text
Total = Base + Surcharges - Invoice credit
```

A takeover combines the beneficiary’s Base, Surcharges, and Invoice credit into the payer’s row before the Total is produced.

### Recalculate a closed pool

Use **Recalculate pool** only when a closed pool’s frozen shares are wrong because settings, assignments, exemptions, takeovers, surcharges, attendance dates, or accepted invoices changed.

Recalculation is destructive to the existing share records:

- Every current share row is deleted and generated again.
- Every previous Paid or Outstanding marker and its recorded payment time is lost.
- The pool remains closed after the new calculation.
- Participants with email addresses receive the final-share notification again.
- Invoice records and their review statuses remain; they are not recreated.

Recommended procedure:

1. Record the current shares and settlement markers outside Surveyor when they are needed for reconciliation.
2. Correct all base settings, assignment selections, exemptions, takeovers, surcharges, attendance dates, and invoice reviews.
3. Recheck the intended calculation.
4. Select **Recalculate pool** and confirm the warning.
5. Compare every replacement share with the expected result.
6. Re-enter the correct settlement markers with the Paid switches.

There is no undo control for a recalculation.

### Record whether a share is settled

After pool closure, **Outstanding shares** lists each payer, covered beneficiaries, Base, Extra, Invoice credit, Total, Notes, and a **Paid** switch.

Use the switch only after the real-world amount has been settled:

- For a positive Total, Paid means the payer’s amount has been received.
- For a negative Total, Paid means the credit owed to the participant has been paid out.
- Clear the switch to return a mistaken or reversed settlement to Outstanding.

The switch changes Surveyor’s record and the pool’s **Outstanding payments** or **Credits owed to participants** total. It does not move money. Surveyor emails the participant when the status changes and an email address is available.

## Privacy, proof access, storage, and retention

Invoice data is sensitive. A proof file may contain personal addresses, bank or card information, tax identifiers, itemized purchases, or third-party names.

- Participants can view their own invoice history and proofs.
- Organizers with **Manage Assignments** can view every invoice and proof in the event’s invoice pools.
- Other participants cannot view another person’s invoice amount, description, proof, correction, or rejection reason.
- Participants in an open pool can see the names needed to manage takeover relationships, but not another participant’s invoice ledger.
- Upload the minimum evidence required and avoid unrelated personal information.
- Do not grant invoice-pool administration merely to let somebody view the event dashboard.
- Download proofs only when operationally necessary, store copies securely, and remove local copies according to the group’s privacy policy.

Surveyor stores proof files outside the database in the configured invoice directory and stores the corresponding invoice records in the database. Operators back up both as one state set. JPEG, PNG, GIF, and PDF proofs are limited to 10 MiB.

Automatic invoice retention runs when the application starts and then hourly. When an event’s end date reaches the configured month-based cutoff, Surveyor permanently removes its invoice records and proof files and recalculates affected pool totals. The invoice history and proof are then no longer available in the application. Backup copies have their own retention lifecycle.

Operators should use Production Operations — Persistent files and Invoice retention. The setting is defined in Configuration — Persistent files and retention.

## Troubleshooting

### I cannot see **Invoice pools & payments**

Confirm that:

- The active profile is registered for the event.
- The event has at least one invoice pool.
- You are using the same profile that owns the registration.

### I can see invoice history but cannot submit

Submission requires an open pool assigned to your registration. An organizer may have closed the pool, removed the assignment, or created the pool for a different participant group.

### My invoice is not included in the total

Only Accepted and Closed invoices count. Awaiting-review and Rejected invoices are excluded. Ask an organizer to review the invoice. If the pool is already closed, the organizer must also recalculate the pool before the frozen shares include a newly accepted cost.

### My accepted amount or description changed

Organizers can correct an amount or description when accepting an invoice. Your history preserves and displays the original submission. Contact the organizer when the correction is unexpected.

### I cannot select somebody in **Manage takeovers**

The person must be assigned to the same open pool. You cannot select yourself, a participant already covered by another payer, or a participant whose covered/covering relationship would create a chain. Ask an organizer to reassign an existing takeover.

### A share is different from the simple equal split

Check the pool’s distribution mode, attendance dates, exemptions, offsetting and extra-only surcharges, invoice-credit setting, and takeovers. The Notes column shows the components applied to the payer.

### The pool changed but the shares did not

A closed pool’s shares are frozen. Base settings, assignment choices, surcharge changes, takeover changes, later invoice review, or attendance corrections require **Recalculate pool** before the share rows change.

### A Paid marker disappeared

Recalculation replaces all shares and resets them to Outstanding. Use the reconciliation record made before recalculation to restore the correct settlement states.

### An expected email did not arrive

Notifications require an email address on the participant’s account or guest profile and working email delivery for the Surveyor installation. Check spam folders, confirm the profile email, and ask the operator to review mail delivery when several recipients are affected.

### A proof is unavailable

Check that you are opening your own invoice or are an authorized invoice-pool organizer. The proof may also have reached the installation’s retention cutoff. Organizers should contact the operator rather than exchanging sensitive proofs through an unapproved channel.

---

**Related guides:** [Events](EVENTS.md) · [Permissions and Sharing](PERMISSIONS.md) · [Getting Started](GETTING_STARTED.md)

**Back to:** [User Guide Home](README.md)
