# Invoice Pools and Payments
<!--
documentation-metadata
audience: event participants; event organizers
owner: event invoice-pool maintainers
status: current
last-verified: 2026-09-14
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: searchable saved-share ledger, portrait A4 export, compact takeovers, confirmed admin feedback, and named email recipients; consistent per-participant rounding, reconciliation totals, and long takeover-list layout; invoice submission progress and recovery; pool administration dialogs and takeover groups; weighted participant factors and signed adjustments; calculation previews, payment carry-forward, rollback, configurable calculation emails and saved-state notifications; existing review, proof, settlement, and retention workflows
source-anchors: src/modules/email.ts; src/public/js/shared/alerts.ts; src/public/js/notifications.ts; src/routes/event.ts; src/modules/lib/pdf.ts; src/migrations/1789516800000-AddInvoiceShareRounding.ts; src/modules/lib/invoiceSettlementEmail.ts; src/migrations/1789430400000-AddInvoiceSettlementSnapshots.ts; src/modules/lib/invoiceDistribution.ts; src/public/js/modules/invoice-submission.ts; src/migrations/1789344000000-AddInvoicePoolFactors.ts; src/routes/api/eventInvoices.ts; src/controller/eventPoolController.ts; src/modules/database/services/EventInvoiceService.ts; src/modules/database/entities/event/EventInvoice.ts; src/modules/database/entities/event/EventInvoicePool.ts; src/modules/database/entities/event/EventInvoiceShare.ts; src/modules/database/entities/event/EventInvoiceSurcharge.ts; src/modules/database/entities/event/EventPoolAssignment.ts; src/modules/database/entities/event/EventPoolTakeover.ts; src/views/modules/module_invoice_pool.pug; src/views/event/event-view.pug; src/views/event/event-dashboard.pug; src/public/js/events.ts; src/modules/invoiceRetention.ts; src/modules/lib/fileCommons.ts; tests/integration/invoice-workflows.spec.ts; tests/frontend/ui-behaviors.spec.ts; src/controller/helpController.ts; tests/unit/help-documentation.spec.ts
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
- [Choose participants, factors, and exemptions](#choose-participants-and-exemptions)
- [Manage takeovers](#manage-takeovers-for-the-group)
- [Add a participant-specific surcharge or rebate](#add-a-surcharge)
- [Review, correct, accept, or reject invoices](#review-submitted-invoices)
- [Preview a calculation](#preview-a-calculation)
- [Close a pool and calculate shares](#close-the-pool-and-calculate-shares)
- [Correct a closed pool](#recalculate-a-closed-pool)
- [Roll back pending pool changes](#roll-back-pool-changes)
- [Send settlement emails](#send-settlement-emails)
- [Record settlement](#record-whether-a-share-is-settled)
- [Export saved shares as a PDF](#export-saved-shares-as-a-pdf)

## First understand the two kinds of status

An invoice and its pool have separate lifecycles. **Closed invoice** and **closed pool** do not mean the same thing.

### Pool status

| Pool status | Meaning | Available work |
|---|---|---|
| **Open for invoices** | Costs and allocation rules are still being collected. No final shares have been frozen. | Assigned participants can submit invoices and manage their own takeovers. Organizers can change settings, assignments, factors, exemptions, takeovers, surcharges, and rebates, and can review invoices. |
| **Closed** | Surveyor has generated one final share per payer from the accepted costs and allocation rules saved at the last calculation. | Participants can see their shares. Organizers can record settlement, including while pool edits are pending. Settings can be corrected, but the shares change only after **Recalculate pool**. New invoices cannot be submitted. |

Closing a pool does not delete it, and there is no ordinary **Reopen pool** or **Delete pool** control. **Recalculate pool** replaces the shares while the pool remains closed.

**Recalculation required** means saved calculation inputs have changed since the last calculation. Previously calculated shares stay visible, and organizers can still record payments against those amounts. Preview the new calculation, then apply it or roll back pending pool changes. Recorded payments are carried forward when recalculating.

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

The form immediately shows submission status and prevents another submission while this one is running. When upload progress is available, the percentage measures the proof transfer; it does not mean the invoice has been saved yet. After transfer, wait for the saving confirmation. A longer request displays further status messages.

Keep the page open until success is confirmed. If the connection fails and Surveyor cannot confirm the result, use **Check invoice history** before trying again. The server may already have saved the invoice. A validation error lets you correct the form and submit again. Email delivery does not delay the successful upload response.

The proof is required. Surveyor accepts JPEG, PNG, GIF, or PDF files up to 10 MiB. Use a clear receipt, invoice, or payment record, but include only the personal and financial information needed for the organizer to verify the cost.

After the form confirms **Invoice submitted successfully**, select **View invoice history** to refresh the page and see the saved record. This also makes the submission form available for a separate invoice.

After a successful submission:

- The saved invoice appears in **Your invoice history** as **Awaiting review** when the history is refreshed.
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

A takeover means that one participant, the **payer**, accepts the final share of another participant, the **beneficiary**. The beneficiary’s base amount, surcharges, rebates, and invoice credit are combined into the payer’s result. Any money the beneficiary already settled remains with them and can produce a separate refund or balance after recalculation.

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

Expand **View _N_ takeovers** to check current coverage relationships in the pool. When email addresses are available, Surveyor emails both the payer and beneficiary after a takeover is added or removed and identifies who made the change.

A takeover is a calculation instruction, not a payment. It takes effect when the organizer closes or recalculates the pool.

### Understand your final share

After the organizer closes a pool, **Your pool shares** shows the row assigned to you as payer. Start with **Remaining due / refund** and **Status**. The other columns show its components and saved notes.

| Field | Meaning |
|---|---|
| **Base** | Your automatic portion of the distributable invoice total, weighted by attendance and your pool-specific factor, plus the portions of people you cover. |
| **Adjustments** | Signed participant-specific surcharges or rebates assigned to you or to people you cover. Negative amounts reduce the share. |
| **Invoice credit** | Accepted invoices submitted by you or people you cover when **Deduct submitter invoices from their share** is enabled. |
| **Previously settled** | Signed payments or payouts carried forward from earlier calculations. Positive means received from the payer; negative means paid out to the payer. |
| **Remaining due / refund** | `Base + Adjustments - Invoice credit - Previously settled`. The saved amount stays visible after payment; check Status to see whether it has been settled. |
| **Notes** | Saved calculation details, including attendance weight, factors, exemptions, takeovers, surcharges, rebates, and invoice credits. |
| **Status** | **Due** means money is owed by the payer; **Refund** means money is owed to them; **Settled** means the amount has been recorded as paid or no payment is needed. |

For **Due**, the positive balance is owed by the payer. For **Refund**, the negative balance is owed to the payer. **Settled** means no further payment is needed for this calculation, even when its original balance remains displayed. Zero is settled automatically.

**Paid** is only a manual settlement marker. Surveyor does not charge a card, send a transfer, or prove that money changed hands. For a negative share, Paid means the credit has been settled with the participant.

When calculation emails are enabled, Surveyor emails each payer who has an email address after closing or recalculating. Organizers can also send settlement emails later. Messages use the saved payment state: already settled shares show no outstanding balance, and outstanding shares show only the remaining amount. Changing the **Paid** switch also generates a payment-status email when an address is available. Emails address the recipient by name in both the greeting and the To field.

## Organizer tasks

Pool actions show a spinner and status immediately, and prevent duplicate clicks while the request is pending. After five seconds, a further message explains that the server has not yet confirmed the change. Keep the page open and wait for the result. Success and error notices disappear after ten seconds; active progress and **Recalculation required** stay visible while relevant. A change is shown as saved only after the server confirms it.

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
| **Round base shares up** | Rounds every participant's base amount up to the next cent. Clear it to round down. Equal weighted shares always receive the same base amount; a small total surplus or shortfall is shown in the calculation preview. Enabled initially. |
| **Description** | Optional explanation of which expenses belong in the pool. |
| **Assign to all participants** | Includes every current and future event registration. This is selected initially. |
| **Make this the default pool** | Automatically assigns each future event registration while allowing the organizer to choose the current participants separately. |
| **Deduct submitter invoices from their share** | Credits a participant’s accepted invoices against the final share of that participant or their covering payer. This is selected initially. |
| **Limit to participants (disabled when assigned to all)** | Selects current registrations when **Assign to all participants** is off. |

The pool starts as **Open for invoices**. Choose its name carefully; the settings dialog edits the description and distribution mode. Expand the pool to see its summary and invoice ledger. Use **Pool settings**, **Participants & factors**, **Surcharges & rebates**, and **Manage takeovers** for focused editing dialogs.

In **Pool settings**, change the description, distribution mode, **Round base shares up**, or **Send calculation emails automatically**, then select **Save pool settings**. Changing rounding requires recalculation for a closed pool. The email switch sets the default for future calculations; you can override it for an individual calculation. Save each dialog before previewing or calculating. **Close** hides an editing dialog without saving its fields; **Discard edits** resets pending fields to their saved values. Saving reloads the page, so finish one dialog before editing another.

#### Distribution modes

| Visible choice | Calculation |
|---|---|
| **Distribute among participants** | Starts each non-exempt assigned participant with weight 1, then multiplies by their factor. Equal factors give an equal split. |
| **Distribute among days attended** | Multiplies inclusive attendance days by each participant’s factor. |
| **Distribute among nights stayed** | Multiplies nights between arrival and departure by each participant’s factor. A same-day registration contributes zero nights. |

Check participant attendance dates before using days or nights. A later attendance correction changes the result only after the pool is first closed or explicitly recalculated.

### Understand the pool totals

The organizer view shows several different totals. They answer different questions. Expand **Calculation breakdown** to see the detailed cost totals and saved distribution settings.

| Display | What it contains |
|---|---|
| **Total invoices** | Effective amounts of Accepted and Closed invoices. Awaiting-review and Rejected invoices are excluded. |
| **Open invoices** | Effective amounts of Accepted invoices that have not been individually closed. |
| **Additional charges / credits** | Signed charges or rebates added outside the shared invoice costs. |
| **Redistributed surcharges / rebates** | Signed amounts assigned to specific participants and subtracted from the shared distribution. A negative rebate increases the remainder to distribute. |
| **Distributable total** | Total invoices minus redistributed adjustments. |
| **Full total** | Total invoices plus additional adjustments. Redistributed adjustments do not change this total. |
| **Outstanding payments** | Positive shares not marked Paid. |
| **Credits owed** | Absolute value of negative shares not marked Paid. |

Pool totals update as invoices are reviewed, adjustments change, and settlement markers change. In a closed pool, current cost totals can differ from the previous settlement snapshot. **Recalculation required** identifies saved calculation changes; preview them before recalculating or rolling them back. Outstanding payments and credits reflect the saved share balances and their current Paid markers until recalculation. Automatic retention has a separate exception described below.

### Choose participants and exemptions

Open a pool and select **Participants & factors**.

1. Select or clear **Assign to all participants**.
2. Select or clear **Default for new participants**.
3. Select or clear **Deduct submitter invoices from their share**.
4. Use **Search participants** when the event has a long registration list.
5. Select each included registration when the pool is not assigned to all.
6. Set each included participant’s **Share factor**, or leave it at `1`.
7. Select **Exempt** where appropriate.
8. Select **Save participants & factors**. This is available for open and closed pools.

Each factor belongs to this participant in this pool. `1.5` gives 50% more weight than `1`; `0.5` gives half the weight. Factors multiply the selected attendance weight before the total is divided. They do not multiply surcharges, rebates, or invoice credits, and do not increase the total cost of the pool. For example, a 120.00 equal-distribution pool with factors `1`, `1.5`, and `0.5` gives base shares of 40.00, 60.00, and 20.00.

Factors can be from `0` to `1000`, with up to four decimal places. Factor `0` gives no automatic base share. At least one participant needs a positive effective weight when a nonzero shared amount must be distributed. In nights mode, check that someone has at least one night. Exemptions always suppress the base share, regardless of factor.

The two automatic assignment switches are different:

- **Assign to all participants** makes the pool apply to every event registration, including registrations created later.
- **Default for new participants** adds future registrations automatically but does not force every existing registration into the pool.

An exempt participant remains assigned to the pool but receives no automatic Base amount. They can still have a surcharge, a rebate, an invoice credit, or a takeover relationship. Their final result can therefore be positive, zero, or negative.

Removing a participant from a pool also removes incompatible takeovers and adjustments for registrations no longer in the pool. Review the adjustment list after changing the assignment scope.

For a closed pool, save the dialog first. The pool then requires recalculation; the previous shares stay unchanged until you explicitly recalculate.

### Manage takeovers for the group

An organizer can establish or reassign coverage for any payer in the pool.

Expand **Takeovers** to see the counts of covering payers and covered participants. Use **Search takeovers** to find a payer or covered participant, then expand **Covers _N_ participants** to see the names. Select **Edit** to open that payer's coverage directly. The dialog shows the selected coverage and explains why unavailable relationships cannot be chosen. Long participant lists scroll inside the dialog while **Save changes** remains reachable.

1. Open the pool.
2. Select **Manage takeovers** from the pool’s controls.
3. Choose the **Payer**.
4. Use **Search participants** if needed.
5. Select the beneficiaries this payer covers.
6. Select **Save changes**.

The same rules apply as in participant self-service: no self-coverage, one payer per beneficiary, and a covered participant cannot cover somebody else. Organizer reassignment removes the previous payer’s mapping and creates the new one.

Changes send **Invoice takeovers updated** to affected payers and beneficiaries when their profiles have email addresses. The message names the event, pool, actor, and added or removed coverage.

If takeover configuration is corrected after the pool has closed, the existing shares remain unchanged until **Recalculate pool**.

### Add a surcharge

Select **Surcharges & rebates** for a fixed participant-specific adjustment.

1. Select the **Participant**.
2. Under **Amount (negative for a rebate)**, enter a positive surcharge or a negative rebate, such as `-15.00`. Zero is not an adjustment; use at most two decimal places.
3. Enter a required **Note** explaining the adjustment.
4. Decide whether **Redistribute within pool** applies.
5. Select **Add surcharge or rebate**.

The two adjustment modes behave differently:

- **Redistribute within pool** selected: the signed adjustment is subtracted from the shared amount, then added to the participant or covering payer. A surcharge reduces the shared remainder; a rebate increases it. The full pool total stays the same.
- **Redistribute within pool** cleared: the adjustment is added directly to the participant or covering payer after the split. Other base shares stay the same. A surcharge increases the full total; a rebate reduces it, so the organizer must account for the funding of that credit outside the shared costs.

For example, split 100.00 equally between two participants with invoice credits disabled. A redistributed `-10.00` rebate for one participant makes the shared remainder 110.00: each base is 55.00, then the rebate leaves totals of 45.00 and 55.00. With redistribution cleared, the totals are 40.00 and 50.00. Factors affect the base split in either case; the fixed rebate is applied afterward.

Use **Remove** to delete an incorrect adjustment, then add its replacement. The note is shown in share details, so write it for the participant who will read the final calculation.

Adjustments can be added or removed after closure. Each saved change requires **Recalculate pool** before it affects the share rows. Review all adjustments before recalculating.

### Review submitted invoices

Expand the pool’s **Invoices** section to reach **Invoice administration**. It opens automatically for open pools or when invoices await review. Newest submissions appear first.

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

When the submitter has an email address, Surveyor sends an acceptance, rejection, or closure message with the organizer’s displayed actor label. The saved review is confirmed without waiting for email delivery. If another organizer has already reviewed the same invoice, reload its saved status before taking another action. Review actions remain available for an Awaiting-review invoice even if the pool has already been closed. Accepting a cost after pool closure requires **Recalculate pool** before the new cost is represented in the frozen shares.

Resolve or consciously exclude every Awaiting-review invoice before closing the pool whenever possible. Closing a pool ignores Awaiting-review and Rejected invoices.

### Preview a calculation

1. Save the settings, participant factors, adjustments, and takeovers you want to use.
2. Select **Preview calculation**, or **Recalculate pool** for a closed pool.
3. Review each payer's Base, Adjustments, Invoice credit, Previously settled, and Remaining due / refund.
4. Close the dialog to make further edits, or confirm the calculation when the amounts are correct.

Preview does not save shares, close the pool, change payment markers, or send emails. It uses the same calculation and settlement-credit rules as the final action. If someone changes inputs or records a payment after the preview, refresh the preview before applying it.

Expand **How the totals add up** to reconcile the shared costs, rounded base shares, participant adjustments, invoice reimbursements, and previous settlements. **Rounding difference** shows the small surplus or shortfall caused by the selected rounding direction. For example, splitting 100.00 equally three ways gives 33.34 each when rounding up (100.02 total), or 33.33 each when rounding down (99.99 total). Surveyor does not give otherwise equal participants different cents to force a matching total.

Rounding applies to each participant's base before takeover groups are combined. Surcharges, rebates, and invoice reimbursements keep their entered cent amounts. For negative base amounts, rounding up moves toward the greater amount: −33.333 becomes −33.33; rounding down gives −33.34.

#### Reconcile costs and reimbursements

The cost of the pool and the net amount still owed between participants are different totals. When **Deduct submitter invoices from their share** is selected, invoice reimbursements reduce the net shares. Compare the sum of positive shares **minus** refunds with the net total, rather than adding refunds to payments.

For example, one invoice of 1000.00, three redistributed rebates of 5.00, one redistributed surcharge of 10.00, and an additional surcharge of 20.00 give:

| Step | Amount before rounding |
|---|---:|
| Shared invoice costs | 1000.00 |
| Redistributed adjustments: −5 −5 −5 +10 | −5.00 |
| Base to distribute: 1000 − (−5) | 1005.00 |
| All participant adjustments: −5 −5 −5 +10 +20 | 15.00 |
| Allocated costs: 1005 +15 | 1020.00 |
| Invoice reimbursement when enabled | 1000.00 |
| Net calculated shares before rounding | 20.00 |

Add the displayed rounding difference to the allocated costs and net shares. Factors and attendance decide who receives each base portion; takeovers combine those portions and their adjustments without changing these totals. Previously recorded payments or payouts then reduce the net remaining balance. Check exemptions, factors, attendance dates, and the participant selected for every adjustment when a result differs from your expectation.

### Close the pool and calculate shares

Before selecting **Preview calculation**, verify:

1. Every intended participant is assigned.
2. Attendance dates are correct for days or nights distribution.
3. Factors and exemptions are correct.
4. Takeovers are correct.
5. Surcharges, rebates, and their redistribution mode are correct.
6. Every intended invoice is Accepted or Closed.
7. **Deduct submitter invoices from their share** has the intended setting.

Then:

1. Save each editing dialog.
2. Select **Preview calculation**.
3. Review the calculation preview and the **Email participants after this calculation** switch.
4. Select **Close pool & calculate**.

At least one participant must be assigned. Surveyor then:

- Selects Accepted and Closed invoices and ignores Awaiting-review and Rejected invoices.
- Calculates the distributable total after signed redistributed adjustments.
- Divides the Base amount by participant, inclusive-day, or night weights multiplied by individual factors.
- Gives exempt participants no automatic Base amount.
- Adds participant-specific surcharges and negative rebates after the weighted split.
- Applies invoice credits when enabled.
- Combines beneficiaries into their covering payer.
- Creates one share row for each resulting payer.
- Sets nonzero unpaid balances to Outstanding; zero balances need no settlement.
- Marks the pool **Closed**.
- Emails payers with an email address if **Email participants after this calculation** is selected.

The final formula for each payer is:

```text
Calculated share = Base + signed adjustments - Invoice credit
Remaining due / refund = Calculated share - Previously settled
```

A takeover combines the beneficiary’s already calculated Base, adjustments, and Invoice credit into the payer’s row. The beneficiary keeps their own factor; the payer’s factor is not applied again. Each participant's Base is rounded consistently in the direction chosen by **Round base shares up**. The resulting surplus or shortfall remains visible in the preview.

### Recalculate a closed pool

Use **Recalculate pool** after settings, assignments, factors, exemptions, takeovers, surcharges, rebates, attendance dates, or accepted invoices changed. You can continue recording payments against the saved shares while the pool shows **Recalculation required**.

1. Correct and save the inputs.
2. Record any payments or payouts already completed using the current Paid switches.
3. Select **Recalculate pool** and review the preview.
4. Choose whether to **Email participants after this calculation**.
5. Select **Apply recalculation**.

Previously settled money becomes a credit against the new calculation. For example, someone who paid 100.00 and now owes a calculated share of 120.00 gets a remaining share of 20.00. If the new calculation is 80.00, they get a refund of 20.00. If the old share was not marked Paid, its unpaid amount is replaced by the newly calculated amount.

The credit carries across repeated recalculations exactly once. After the additional 20.00 is marked Paid, a later calculated share of 130.00 leaves 10.00 to pay. Payouts work the same way with negative signs: a previously paid-out 30.00 against a revised payout of 20.00 leaves 10.00 to collect back.

Payments stay with the person who made or received them. If a takeover changes the payer, or someone is removed from this pool but remains registered for the event, that person's existing payment can appear as a separate refund share. It is not silently transferred to another payer.

The pool stays closed and invoice review records are unchanged. A failed calculation preserves the old shares and payments. A changed input or payment revision requires a fresh preview. Save or **Discard edits** in open dialogs before calculating.

### Roll back pool changes

Use **Roll back pool changes** when you want to keep the last calculation instead of applying saved pool edits.

1. Open the closed pool marked **Recalculation required**.
2. Select **Roll back pool changes** and read the confirmation.
3. Select **Restore last calculated settings**, read the result, then select **Return to pool**.

Rollback restores the pool's description, distribution settings, rounding direction, email preference, assignments, factors, exemptions, surcharges/rebates, and takeovers from its last successful calculation. Existing shares and recorded payments are preserved. No calculation or settlement email is sent.

Event registrations, attendance dates, and invoice reviews are separate records. Rollback does not undo those changes or recreate deleted participants. If they changed since the last calculation, the pool may still require recalculation after its local settings are restored. Review the result message.

Rollback needs a saved calculation snapshot. Older closed pools without one gain it when they are next successfully recalculated. A snapshot from before the rounding setting was introduced restores with rounding up enabled and still requires recalculation. **Discard edits** only resets unsaved form fields; **Roll back pool changes** restores saved pool inputs. Rollback does not undo an already applied recalculation.

### Send settlement emails

**Send calculation emails automatically** in **Pool settings** controls the default. **Email participants after this calculation** lets you change the choice before closing or recalculating. Both start enabled for a new pool.

To send updates afterward, open a closed pool, select **Send settlement emails**, and confirm. This works even if automatic emails are switched off. It sends to payers with an email address without recalculating, changing payment markers, or moving money.

Emails describe saved settlement amounts and current Paid markers. Settled shares say there is no outstanding balance. Outstanding shares show the remaining payment or refund after earlier settlements. If pool inputs have changed, the message explains that it describes the previous saved calculation. Delivery still depends on the installation's mail service.

### Record whether a share is settled

After pool closure, **Shares & settlement** contains the **Calculated shares** ledger. Each row shows the **Payer**, **Calculated balance**, **Status**, **Calculation details**, and **Paid** switch. Open **View breakdown** for components and notes. When recalculation is required, these are still the saved amounts and the switches remain available; coverage refers to the saved calculation notes.

Use **Search shares** to find payers or calculation notes. **Filter share status** offers **All statuses**, **Due**, **Refund**, and **Settled**. **Sort shares** orders by payer name or amount. Choose 25, 50, or 100 with **Shares per page**, then use **Previous** and **Next** to move through the results.

Use the switch only after the real-world amount has been settled:

- For a positive remaining amount, Paid means that amount has been received.
- For a negative remaining amount, Paid means that refund or payout has been completed.
- Clear the switch to return a mistaken or reversed settlement to **Due** or **Refund**.

The switch changes Surveyor’s record and the pool’s **Outstanding payments** or **Credits owed** total. It keeps the previous saved state while the update is pending, then shows the server-confirmed result. It does not move money. Surveyor emails the participant when the status changes and an email address is available.

Clearing Paid reverses the settlement marker for the currently displayed balance. It does not erase credits carried from earlier calculations. Correct mistaken Paid markers before applying the next recalculation.

### Export saved shares as a PDF

1. Open the pool's **Calculated shares** ledger.
2. Select **Export as PDF**.
3. Save or print the portrait A4 document.

The PDF includes every saved share in the pool, regardless of the screen's search, status filter, sort, or page. It includes component amounts, saved notes, recorded payments, and the amounts still to collect or pay out. A paid share has no remaining amount to settle in the PDF; its recorded settlement remains documented. If **Recalculation required** is shown, the PDF states that it uses the previous saved calculation. Exporting does not recalculate the pool or change payments.

Export requires invoice-pool administration access. Treat the downloaded file as financial participant data and share it only with authorized recipients.

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

Automatic retention preserves previously calculated settlement shares and does not itself require recalculation.
Recalculating later uses only retained invoice records, so complete corrections before the relevant invoices expire.

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

Check the pool’s distribution mode, attendance dates, individual factors, exemptions, redistributed and additional adjustments, invoice-credit setting, and takeovers. Participants can read **Notes** beside their share; organizers can open **View breakdown** in the share ledger.

### The pool changed but the shares did not

A closed pool's calculation stays saved until you apply a recalculation. Save changes in the relevant dialog, then preview and recalculate, or use **Roll back pool changes** to restore saved pool inputs. Settlement switches remain available throughout.

### A recalculated share is Due although I already paid

Check **Previously settled** and the remaining amount. Prior payments reduce the new balance; only a new difference needs settlement. A zero balance is settled automatically. For a refund, the remaining amount is negative.

### An expected email did not arrive

Notifications require an email address on the participant’s account or guest profile and working email delivery for the Surveyor installation. Check spam folders, confirm the profile email, and ask the operator to review mail delivery when several recipients are affected.

### A proof is unavailable

Check that you are opening your own invoice or are an authorized invoice-pool organizer. The proof may also have reached the installation’s retention cutoff. Organizers should contact the operator rather than exchanging sensitive proofs through an unapproved channel.

---

**Related guides:** [Events](EVENTS.md) · [Permissions and Sharing](PERMISSIONS.md) · [Getting Started](GETTING_STARTED.md)

**Back to:** [User Guide Home](README.md)
