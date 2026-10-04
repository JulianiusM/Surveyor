# Invoice Pools and Payments
<!--
documentation-metadata
audience: event participants; event organizers
owner: event invoice-pool maintainers
status: current
last-verified: 2026-10-04
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: optional organizer participant attribution with independent recorder audit and existing credit/history/proof ownership; unchanged original saved notes before the email calculation disclosure; figures-only typed global calculation breakdown, total/base and optional anonymous payer steps inside a separate example, explanation-free compact PDF, success-only settlement-email dialog closure, and fresh-summary source deduplication; completed correcting-transfer cleanup, direct participant email wording, shared PDF pool-cost explanation, independent overview example disclosure and consistent exemption captions; active paid/refunded payer identity and applied responsibility notices; restored role-specific balance captions; explicit pending-coverage indicators; contextual full pool totals and shares export labels; pure shared coverage evidence owner, unknown legacy baselines and direct-import boundaries; established visual-component reuse and shared PDF sectionTitle; deterministic positive anonymous example selection, honest covering introductions and missing-evidence fallbacks; abbreviated exempt and zero-weight personal explanations; applied versus pending closed takeovers, post-recalculation delta notices and silent rollback; independent OPEN and ORGANIZER_ONLY initial states, default OPEN creation with Invoice submissions choice, reversible participant submission access with confirmation and revision checks, permanent financial closure, and guarded organizer-only migration; notes-first settlement emails with client-dependent native calculation disclosure, complete plain-text content, and opt-in leading actions; covered-participant count/name summaries; Payment due wording; structured anonymous pool examples in preview, organizer details and PDF; concrete complete payer explanations in dialogs and emails, separated from factual notes; cross-pool personal share ledger with one reusable read-only dialog; contextual current-source and saved-settlement totals; explicitly named attendance/factor/weight inputs; adaptive signed adjustment-category provenance and component displays; retained collect/refund totals; compact settlement statuses, nonrepeated PDF row details, and required PDF visual verification; invoice feature-folder orchestration, mandatory JSDoc plus internal step comments, catalog-owned localization-ready messages, prohibition of imported re-exports, calculated-balance-first settlement presentation, and compact payment/refund actions; responsive shares, saved numeric calculation provenance, signed settlement trace, frontend confirmation gates, and controller-owned invoice business operations; invoice correction and retraction lifecycles, refreshed submission history, and searchable payer rows with beneficiary chips; organizer-entered shared costs, repeat invoice submissions, visible payment feedback, and share breakdown dialogs; searchable saved-share ledger, portrait A4 export, compact takeovers, confirmed admin feedback, and named email recipients; consistent per-participant rounding, reconciliation totals, and long takeover-list layout; invoice submission progress and recovery; pool administration dialogs and takeover groups; weighted participant factors and signed adjustments; calculation previews, payment carry-forward, rollback, configurable calculation emails and saved-state notifications; existing review, proof, settlement, and retention workflows
source-anchors: tests/e2e/invoice-organizer-expenses.spec.ts; tests/integration/organizer-invoices.spec.ts; tests/frontend/invoice-organizer-attribution.spec.ts; src/modules/invoice/settlements.ts; src/modules/invoice/coverage.ts; src/migrations/1790985600000-AddInvoicePoolOrganizerOnlyState.ts; src/modules/invoice/takeovers.ts; tests/unit/invoice-presentation.spec.ts; src/modules/invoice/wording.ts; src/modules/invoice/locales/en.ts; src/modules/invoice/calculation.ts; src/modules/invoice/poolOperations.ts; src/modules/invoice/invoiceOperations.ts; src/modules/invoice/notifications.ts; src/modules/invoice/requests.ts; src/modules/invoice/proofs.ts; src/modules/invoice/exports.ts; src/modules/invoice/presentation.ts; src/types/InvoicePoolTypes.d.ts; src/types/EmailTypes.d.ts; src/migrations/1789689600000-AddInvoiceRetraction.ts; src/migrations/1789603200000-AddOrganizerInvoices.ts; src/modules/email.ts; src/public/js/shared/alerts.ts; src/public/js/notifications.ts; src/routes/event.ts; src/modules/lib/pdf.ts; src/migrations/1789516800000-AddInvoiceShareRounding.ts; src/modules/invoice/settlementEmail.ts; src/migrations/1789430400000-AddInvoiceSettlementSnapshots.ts; src/modules/invoice/distribution.ts; src/public/js/modules/invoice-submission.ts; src/migrations/1789344000000-AddInvoicePoolFactors.ts; src/routes/api/eventInvoices.ts; src/controller/eventPoolController.ts; src/modules/database/services/EventInvoiceService.ts; src/modules/database/entities/event/EventInvoice.ts; src/modules/database/entities/event/EventInvoicePool.ts; src/modules/database/entities/event/EventInvoiceShare.ts; src/modules/database/entities/event/EventInvoiceSurcharge.ts; src/modules/database/entities/event/EventPoolAssignment.ts; src/modules/database/entities/event/EventPoolTakeover.ts; src/views/modules/module_invoice_pool.pug; src/views/event/event-view.pug; src/views/event/event-dashboard.pug; src/public/js/events.ts; src/modules/invoice/retention.ts; src/modules/lib/fileCommons.ts; tests/integration/invoice-workflows.spec.ts; tests/frontend/ui-behaviors.spec.ts; src/controller/helpController.ts; tests/unit/help-documentation.spec.ts
next-review: invoice-pool-visible-UI-or-behavior-change
-->

Invoice pools help an event group collect receipts, decide which costs count, and calculate who owes or is owed money. Surveyor records the calculation and settlement status; it does not collect money or initiate bank transfers.

## Choose your task

### Participant

- [Submit an invoice](#submit-an-invoice)
- [Check an invoice or close an accepted invoice](#check-your-invoice-history)
- [Retract an invoice awaiting review](#retract-an-invoice-awaiting-review)
- [Pay for another participant](#choose-whose-share-you-will-cover)
- [Understand your final share](#understand-your-final-share)

### Organizer

- [Create an invoice pool](#create-an-invoice-pool)
- [Choose participants, factors, and exemptions](#choose-participants-and-exemptions)
- [Manage takeovers](#manage-takeovers-for-the-group)
- [Add a participant-specific surcharge or rebate](#add-a-surcharge)
- [Add an organizer expense to the shared costs](#add-an-organizer-expense)
- [Review, correct, accept, or reject invoices](#review-submitted-invoices)
- [Stop or resume participant submissions](#stop-or-resume-participant-submissions)
- [Correct or reject an accepted or closed invoice](#correct-or-reject-an-accepted-or-closed-invoice)
- [Preview a calculation](#preview-a-calculation)
- [Close a pool and calculate shares](#close-the-pool-and-calculate-shares)
- [Correct a closed pool](#recalculate-a-closed-pool)
- [Roll back pending pool changes](#roll-back-pool-changes)
- [Send settlement emails](#send-settlement-emails)
- [Record payments and refunds](#record-whether-a-share-is-settled)
- [Export saved shares as a PDF](#export-saved-shares-as-a-pdf)

## First understand the two kinds of status

An invoice and its pool have separate lifecycles. **Closed invoice** and **closed pool** do not mean the same thing.

### Pool status

| Pool status | Meaning | Available work |
|---|---|---|
| **Open for invoices** | Costs and allocation rules are still being collected. No final shares have been frozen. | Assigned participants can submit invoices and manage their own takeovers. Organizers can change settings, assignments, factors, exemptions, takeovers, surcharges, and rebates, review participant invoices, and add organizer expenses. |
| **Organizer invoices only** | Participant submissions and participant takeover editing are unavailable; no final shares have been calculated yet. | Organizers can add and review costs, edit allocation inputs, select **Open participant invoices** to allow participant submissions, or preview and calculate shares. |
| **Closed** | Surveyor has generated one final share per payer from the accepted costs and allocation rules saved at the last calculation. | Participants can see their shares but cannot submit new invoices. Organizers can record settlement, correct settings, and add organizer expenses. Saved cost or allocation changes affect the shares only after **Recalculate pool**. |

Closing a pool does not delete it, and there is no ordinary **Reopen pool** or **Delete pool** control. **Recalculate pool** replaces the shares while the pool remains closed.
**Open for invoices** and **Organizer invoices only** are independent choices when creating a pool. Each can close
directly with **Close pool & calculate**; no additional pool state is required first.
**Close participant invoices** is a separate action before calculation: it stops participant submissions without
calculating shares, and can be reversed with **Open participant invoices**. A financially closed pool cannot reopen
participant submissions.

**Recalculation required** means saved calculation inputs have changed since the last calculation. Previously calculated shares stay visible, and organizers can still record payments against those amounts. Preview the new calculation, then apply it or roll back pending pool changes. Recorded payments are carried forward when recalculating.

### Invoice status

| Visible status | How it starts | What happens next | Included in pool costs? |
|---|---|---|---|
| **Awaiting review** | An assigned participant submits an invoice and proof to an open pool. | An organizer can **Accept** or **Reject** it. Its submitter can **Retract** it before review. | No. |
| **Accepted** | An organizer accepts an awaiting-review participant invoice or adds an organizer expense. | The attributed participant or an organizer can **Close** the invoice. Organizers can also **Correct** or **Reject from pool**, with confirmation. | Yes, using the accepted corrected amount when one exists. |
| **Rejected** | An organizer rejects an unreviewed invoice or removes an accepted or closed invoice from the pool. | Its record and proof remain in history. Submit a replacement if needed while the pool is open. | No. |
| **Closed** | The attributed participant or an organizer closes an accepted invoice. | Its record remains in history. Organizers can still **Correct** or **Reject from pool**, with confirmation. | Yes. |
| **Retracted** | The submitter withdraws an invoice that was awaiting review. | Its details and proof remain in history, with no further review action. Submit a replacement if needed while the pool is open. | No. |

Closing an accepted invoice records completion of its ordinary review; organizers can still confirm a later correction or rejection. Closing does **not** remove the cost, mark anyone’s share as paid, or close the pool. Both Accepted and Closed invoices remain included in pool costs.

## Who can use invoice-pool controls

### Participants

You can submit invoices or change your takeovers when all of the following are true:

1. You are registered for the event with the active profile.
2. The organizer assigned your registration to the pool, or the pool applies to all participants.
3. The pool is open for submission or takeover changes.

A participant can submit only their own invoice, retract only their own invoice awaiting review, change only the takeovers for which they are the payer, view only their own invoice history and proof, close only their own accepted invoice, and view only their own final share.

### Organizers

The event owner receives all event permissions. Another organizer needs:

- **Access Admin** to open **Event administration dashboard**.
- **Manage Assignments** to see and operate **Invoice pools**, including all invoices, proofs, assignments, takeovers, surcharges, shares, and settlement controls.

An organizer with these permissions can add shared pool expenses without registering as an event participant.

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

After the form confirms **Invoice submitted successfully**, Surveyor briefly shows success and refreshes the page automatically. **Invoice pools & payments** and **Submit an invoice & history** reopen with the saved invoice in history. The next submission form has blank amount, description, and proof fields and keeps the selected pool when it is still available. Wait for the refresh before starting another invoice; **View invoice history** opens the refreshed history sooner.

After a successful submission:

- The saved invoice appears in the refreshed **Your invoice history** as **Awaiting review**.
- Surveyor assigns it an invoice number.
- The organizer can view the submitted amount, description, and proof.
- Surveyor sends **Invoice submitted** to the email address attached to your account or guest profile, when an address is available and email delivery is configured.

Surveyor does not notify organizers by email about each new submission. They review new entries in **Invoice administration**.

#### No open pool is available

**No open pools for submissions right now.** means that you are not assigned to an open pool. Confirm that you are using the registered profile, then ask an organizer whether participant submissions have been stopped, the pool has been calculated and closed, or your registration needs to be assigned.

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
- **Retract**, only while the invoice is Awaiting review.

The original amount and description remain visible when an organizer records a correction, including a later correction to an Accepted or Closed invoice.

Use **Search invoices** to search the invoice number, pool, amount, description, correction, or rejection reason. Use **All statuses** to filter Awaiting review, Accepted, Rejected, Closed, or Retracted entries. Choose 25, 50, or 100 rows per page and use **Previous** or **Next** for a longer history.

#### What to do for each status

- **Awaiting review:** wait for an organizer, or select **Retract** if you submitted the wrong invoice. You cannot edit its original details or delete its history.
- **Accepted:** review any correction. Select **Close** when the accepted invoice needs no further review discussion.
- **Rejected:** read the reason. Contact an organizer when clarification is needed, then submit a replacement while the pool is open. The rejected record and proof remain in history.
- **Closed:** no further invoice action is required. The cost remains included in pool totals.
- **Retracted:** the invoice is excluded from review and costs. Submit a new invoice if a replacement is needed and the pool remains open.

When your profile has an email address, Surveyor sends a message after acceptance, correction, rejection, closure, or your retraction. The acceptance email states the effective accepted amount and any organizer correction. The rejection email includes the reason.

### Retract an invoice awaiting review

1. Find your invoice in **Your invoice history**.
2. Select **Retract** on an **Awaiting review** invoice.
3. Check the invoice in **Retract invoice**, then select **Confirm retraction**.

The invoice becomes **Retracted** and keeps its details and proof in history. It no longer awaits an organizer's decision. You can retract your own unreviewed invoice even after pool closure; it was never included in calculated costs, so retraction does not change the saved shares or payments. It does not reopen the pool for a replacement upload.

If an organizer already reviewed it or the pool changed while the dialog was open, refresh the page and check its current status. Accepted or Closed invoices need an organizer's correction or rejection instead.

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

Each payer has a row with name badges for the participants they cover. Use **Search takeovers** to find either name; matching covered participants appear even when their badges were hidden in a longer list. **Show all** reveals the rest of a payer's beneficiaries, and **Show fewer** returns to the compact view. Use **Previous** and **Next** for more payers. When email addresses are available, Surveyor emails both the payer and beneficiary after a takeover is added or removed and identifies who made the change.

A takeover is a calculation instruction, not a payment. It takes effect when the organizer closes or recalculates the pool.

### Understand your final share

After the organizer closes a pool, **Your pool shares** lists your saved shares across pools. Each row shows the pool,
signed **Calculated balance**, and payment status; phones and tablets show the same information as cards. The amount
stays visible after payment or refund. Read the status to see what you need to do:

- **Payment due:** you must pay the positive calculated balance.
- **Refund due:** you must receive the negative calculated balance as a refund.
- **Paid:** the organizer recorded your payment.
- **Refunded:** the organizer recorded your refund; its amount stays negative.
- **No payment:** the calculated balance is zero.

Use **Search pools or calculation notes**, **Filter share status**, **Sort pools**, **Shares per page**, **Previous**,
and **Next** to find a share, including when the event has many pools. Select **View breakdown** in its row to open
the read-only dialog. It shows applicable components, your actual **Calculation explanation**, and separate original
**Saved calculation notes**. Unused adjustments or credits and repeated derived amounts are omitted.

| Field | Meaning |
|---|---|
| **Base share** | Your automatic portion of the base to distribute, weighted by attendance and your pool-specific factor, plus the portions of people you cover. |
| **Adjustments** | Signed surcharges or rebates assigned to you or people you cover. Negative amounts reduce the share. |
| **Invoice credit** | Counted invoices attributed to you or people you cover when **Deduct submitter invoices from their share** is enabled, including organizer-entered invoices assigned to the participant who paid. |
| **Previously settled** | Signed transfers carried from earlier calculations: positive payments received from the payer, or negative refunds paid to the payer. |
| **Calculated balance** | Base share, plus applicable adjustments, minus invoice credit and previously settled money. This is the primary amount and stays visible after settlement. |
| **Calculation explanation** | Formatted arithmetic for your own share and every participant you cover, with named inputs and the final saved balance. |
| **Saved calculation notes** | Actual attendance, factors, exemptions, takeovers, adjustments, and invoice credit recorded with the calculation. These facts are separate from the arithmetic explanation. |

For example, a calculated balance of `-25.00` has **Refund due** before recording and **Refunded**
after recording. The primary amount remains `-25.00`.

Your **Calculation explanation** uses your name and the names of participants you cover. When you cover others,
their count and names appear before the individual calculations. It shows each actual base
share, with attendance in nights, inclusive days, or participants and any **Share factor** explicitly named, then
combines covered base shares and applies relevant adjustments, invoice credits, and previously settled money.
The result is your saved calculated balance. Covered participants retain their own factor and rounding before their
shares are combined. Unrelated payers' calculations are excluded.

If you are exempt or have no automatic distribution weight, and nobody you cover has positive automatic weight,
the explanation stays short: it shows the exemption or zero-weight inputs, any fixed adjustments and credits, and
your saved balance. Shared cost and divisor steps remain when they explain an eligible participant you cover.

The explanation includes only features used by this pool. Redistributed surcharges reduce the base to distribute;
redistributed rebates increase it. On-top surcharges or rebates leave the base unchanged and change the full total
and the affected payer's result. Used surcharge and rebate totals remain separate even when they cancel each other.
These inputs belong to the saved calculation even when current settings or attendance have changed. Older calculations
retain their amounts and notes; any unavailable saved inputs are identified rather than reconstructed from current edits.

**Record payment** and **Record refund** record transfers already completed outside Surveyor. Surveyor does not
charge a card, send a transfer, or prove that money changed hands. Organizers review the signed calculated balance
and confirm. Cancelling or dismissing the review leaves the saved state unchanged.

Calculation emails and PDFs use the same labels, signed calculated balance, and explicit payment/refund status.
Recording or undoing a transfer also generates a status email when an address is available. Emails address the
recipient by name in both the greeting and the To field.

## Organizer tasks

Pool actions show a spinner and status immediately, and prevent duplicate clicks while the request is pending. After five seconds, a further message explains that the server has not yet confirmed the change. Keep the page open and wait for the result. Success and error notices disappear after ten seconds; active progress and **Recalculation required** stay visible while relevant. A change is shown as saved only after the server confirms it.

### Create an invoice pool

1. Open the event.
2. Select **Event administration dashboard**.
3. Find **Invoice pools**.
4. Select **Create pool**.
5. Complete **Create a new pool**.
   Choose **Invoice submissions** as **Open for invoices** or **Organizer invoices only**.
6. Select **Add pool**.

#### Creation fields

| Field | Purpose |
|---|---|
| **Pool name** | Required name, up to 255 characters. Choose a name participants can recognize in the submission list. |
| **Invoice submissions** | **Open for invoices** allows assigned participants to submit invoices and edit their takeovers; this is the default. **Organizer invoices only** starts directly with organizer-entered costs and organizer control of takeovers. Both choices allow organizer review and direct calculation. |
| **Share distribution mode** | Chooses how the distributable total is divided when the pool closes. |
| **Round base shares up** | Rounds every participant's base amount up to the next cent. Clear it to round down. Equal weighted shares always receive the same base amount; a small total surplus or shortfall is shown in the calculation preview. Enabled initially. |
| **Description** | Optional explanation of which expenses belong in the pool. |
| **Assign to all participants** | Includes every current and future event registration. This is selected initially. |
| **Make this the default pool** | Automatically assigns each future event registration while allowing the organizer to choose the current participants separately. |
| **Deduct submitter invoices from their share** | Credits a participant’s accepted invoices against the final share of that participant or their covering payer. This is selected initially. |
| **Limit to participants (disabled when assigned to all)** | Selects current registrations when **Assign to all participants** is off. |

The pool starts in your chosen **Invoice submissions** state; **Open for invoices** is selected by default.
Choose its name carefully; the settings dialog edits the description and distribution mode. Expand the pool to see
its summary and invoice ledger. Use **Pool settings**, **Participants & factors**, **Surcharges & rebates**, and
**Manage takeovers** for focused editing dialogs.

In **Pool settings**, change the description, distribution mode, **Round base shares up**, or **Send calculation emails automatically**, then select **Save pool settings**. Changing rounding requires recalculation for a closed pool. The email switch sets the default for future calculations; you can override it for an individual calculation. Save each dialog before previewing or calculating. **Close** hides an editing dialog without saving its fields; **Discard edits** resets pending fields to their saved values. Saving reloads the page, so finish one dialog before editing another.

#### Distribution modes

| Visible choice | Calculation |
|---|---|
| **Distribute among participants** | Starts each non-exempt assigned participant with weight 1, then multiplies by their factor. Equal factors give an equal split. |
| **Distribute among days attended** | Multiplies inclusive attendance days by each participant’s factor. |
| **Distribute among nights stayed** | Multiplies nights between arrival and departure by each participant’s factor. A same-day registration contributes zero nights. |

Check participant attendance dates before using days or nights. A later attendance correction changes the result only after the pool is first closed or explicitly recalculated.

### Stop or resume participant submissions

Use these controls to change whether participants can submit invoices before the pool is calculated and closed.

1. Open the uncalculated pool.
2. Select **Close participant invoices**.
3. Review the confirmation, then select **Close participant invoices** again.

The pool shows **Organizer invoices only**. Participants can no longer submit invoices or edit takeovers; their
existing invoice history remains available. Organizers can still add expenses, review invoices, change allocation
inputs, and preview or calculate shares. This action keeps the existing costs and settings and does not calculate
shares or record settlements.

To allow participant submissions before calculation, select **Open participant invoices** and confirm. This also
works for a pool created directly as **Organizer invoices only**. The pool becomes **Open for invoices**.
Save or discard any open editing drafts first. If the pool changes while you review
the action, reload and check its current state before trying again. Once **Close pool & calculate** has made the pool
**Closed**, participant submissions cannot reopen.

### Understand the pool totals

Closed-pool headers keep **Full pool total**, **Payments due**, and signed **Refunds due** visible. Expand the pool for
context, including **Base to distribute** when redistributed adjustments are used. **Calculation breakdown** separates
used surcharges and rebates by their redistribution mode, even when they cancel to zero, and retains relevant invoice
and settlement totals as labelled numbers. It also lists the assigned participant count and applicable total days or
nights, eligible units, exemptions, and factor-weighted total weight. It contains figures only; **Example calculation**
contains the explanation and arithmetic. These figures describe the whole pool, not just an example participant.
The two due totals remain visible as zero when all saved shares are settled. Distribution settings
are available in **Pool settings** and **Participants & factors**. Expand the separate **Example calculation** to see
how the pool totals and base are calculated, followed by an anonymous participant's calculation when one applies.
Each payer's **View breakdown** explains their concrete saved share.

| Display | What it contains |
|---|---|
| **Invoice costs** | Effective amounts of Accepted and Closed invoices counted as shared costs. |
| **Accepted invoice costs** | Counted invoices still marked Accepted, rather than Closed. Awaiting-review submissions are excluded. Closing an invoice does not settle a share. |
| **Base to distribute** | Invoice costs minus signed redistributed adjustments, before rounding and participant-specific adjustments or credits. |
| **Redistributed surcharges** | Positive amounts assigned to specific participants and subtracted from the shared base. They do not change the full total. |
| **Redistributed rebates** | Negative amounts assigned to specific participants. Subtracting them increases the shared base without changing the full total. |
| **On-top surcharges** | Positive amounts added after the base split. They increase the full total without changing other base shares. |
| **On-top rebates** | Negative amounts applied after the base split. They reduce the full total without changing other base shares. |
| **Full pool total** | Effective Accepted and Closed invoice amounts plus on-top adjustments. Awaiting-review, Rejected, and Retracted invoices are excluded. Redistributed adjustments do not change this total. |
| **Payments due** | Positive remaining balances. |
| **Refunds due** | Negative remaining balances, displayed with their negative sign. |
| **Invoice credit** | Counted registration-attributed invoices deducted from saved payer shares, including organizer-entered invoices assigned to the participant who paid. |
| **Previously settled** | Signed credits carried from earlier calculations. |
| **Payments received** | Positive calculated balances recorded as paid in this saved calculation. |
| **Refunds paid** | Negative calculated balances recorded as refunded in this saved calculation. |
| **Rounding difference** | A nonzero surplus or shortfall caused by rounding each participant's base share. |

Unused contextual totals are omitted. A current closed calculation does not repeat cost amounts already listed in
its saved breakdown; applicable **Accepted invoice costs** and settlement totals remain. Open pools, stale calculations,
and older calculations with unavailable saved cost inputs retain the relevant current cost details. When invoice costs,
the base to distribute, and the full pool total are equal in an ordinary pool without adjustments, one cost figure is
shown; **Example calculation** explains the equality. Used adjustments retain the relevant cost scopes even when their
amounts coincide. An older calculation without saved numeric inputs shows **Saved calculation inputs: Not saved**;
known historical amounts remain available, while an unprovable **Full pool total** is marked **Unavailable**.
Pool totals update as invoices are reviewed, adjustments change, and settlement markers change. In a stale closed pool,
**Current pool costs** and **Saved settlement totals** distinguish newer inputs
from the saved calculation. **Recalculation required** identifies saved calculation changes; preview them before
recalculating or rolling them back. Payments due and refunds due reflect saved shares and their current settlement
state until recalculation. Received/refunded totals describe this calculation only; **Previously settled** retains
carried credits separately, including zero when positive and negative carried credits cancel. These totals are not a
complete chronological transfer history. Automatic retention has a separate exception described below.

### Choose participants and exemptions

Open a pool and select **Participants & factors**.

1. Select or clear **Assign to all participants**.
2. Select or clear **Default for new participants**.
3. Select or clear **Deduct submitter invoices from their share**.
4. Use **Search participants** when the event has a long registration list.
5. Select each included registration when the pool is not assigned to all.
6. Set each included participant’s **Share factor**, or leave it at `1`.
7. Select **Exempt** where appropriate.
8. Select **Save participants & factors**. This is available in all pool statuses.

Each factor belongs to this participant in this pool. `1.5` gives 50% more weight than `1`; `0.5` gives half the weight. Factors multiply the selected attendance weight before the total is divided. They do not multiply surcharges, rebates, or invoice credits, and do not increase the total cost of the pool. For example, a 120.00 equal-distribution pool with factors `1`, `1.5`, and `0.5` gives base shares of 40.00, 60.00, and 20.00.

Factors can be from `0` to `1000`, with up to four decimal places. Factor `0` gives no automatic base share. At least one participant needs a positive effective weight when a nonzero shared amount must be distributed. In nights mode, check that someone has at least one night. Exemptions always suppress the base share, regardless of factor.

The two automatic assignment switches are different:

- **Assign to all participants** makes the pool apply to every event registration, including registrations created later.
- **Default for new participants** adds future registrations automatically but does not force every existing registration into the pool.

An exempt participant remains assigned to the pool but receives no automatic Base share. They can still have a surcharge, a rebate, an invoice credit, or a takeover relationship. Their final result can therefore be positive, zero, or negative.

Removing a participant from a pool also removes incompatible takeovers and adjustments for registrations no longer in the pool. Review the adjustment list after changing the assignment scope.

For a closed pool, save the dialog first. The pool then requires recalculation; the previous shares stay unchanged until you explicitly recalculate.

### Manage takeovers for the group

An organizer can establish or reassign coverage for any payer in the pool.

**Takeovers** lists each payer beside badges for the participants they cover. **Search takeovers** finds a payer or covered participant, including beneficiaries beyond the initial six badges. Select **Show all** to inspect a longer group and **Show fewer** to collapse it; long badge lists scroll within their row. Choose 10, 25, or 50 payers per page and use **Previous** or **Next** to move through the list.

Select **Edit** in a payer's row to change their coverage. **Manage takeovers** also lets you choose any payer. The editing dialog shows selected coverage and explains unavailable choices. Long lists scroll inside the dialog while **Save changes** remains reachable.

1. Open the pool.
2. Select **Manage takeovers** from the pool’s controls.
3. Choose the **Payer**.
4. Use **Search participants** if needed.
5. Select the beneficiaries this payer covers.
6. Select **Save changes**.

The same rules apply as in participant self-service: no self-coverage, one payer per beneficiary, and a covered participant cannot cover somebody else. Organizer reassignment removes the previous payer’s mapping and creates the new one.

Before shares are calculated, changes send **Invoice takeovers updated** to affected payers and beneficiaries when
their profiles have email addresses. The message names the event, pool, actor, and added or removed coverage.

After closure, **Takeovers** first shows the coverage used by the saved calculation. Organizer edits appear separately
under **Pending takeover changes** and leave saved shares unchanged. **Takeover changes pending** also appears in
the collapsed pool header and beside those edits. Participants are notified only after a successful
**Apply recalculation**, using the difference between the previous applied coverage and the final new coverage.
Intermediate edits, a failed calculation, or **Roll back pool changes** send no coverage notification. This notification
is independent of **Email participants after this calculation**. Older calculations without saved coverage evidence
identify that absence instead of displaying pending edits as applied coverage. They establish a coverage baseline on
their next successful calculation without guessing which responsibilities changed before it. Their editable current
choices appear under **Takeovers for next calculation**.

### Add a surcharge

Select **Surcharges & rebates** for a fixed participant-specific adjustment.

1. Select the **Participant**.
2. Under **Amount (negative for a rebate)**, enter a positive surcharge or a negative rebate, such as `-15.00`. Zero is not an adjustment; use at most two decimal places.
3. Enter a required **Note** explaining the adjustment.
4. Decide whether **Redistribute within pool** applies.
5. Select **Add surcharge or rebate**.

The two adjustment modes behave differently:

- **Redistribute within pool** selected: the signed adjustment is subtracted from the shared amount, then added to the participant or covering payer. A redistributed surcharge reduces the shared remainder; a redistributed rebate increases it. The full pool total stays the same.
- **Redistribute within pool** cleared: the on-top surcharge or rebate is applied directly to the participant or covering payer after the split and labelled **On-top surcharge / rebate** in the adjustment list. Other base shares stay the same. An on-top surcharge increases the full total; an on-top rebate reduces it, so the organizer must account for the funding of that rebate outside the shared costs.

For example, split 100.00 equally between two participants with invoice credits disabled. A redistributed `-10.00` rebate for one participant makes the shared remainder 110.00: each base is 55.00, then the rebate leaves totals of 45.00 and 55.00. With redistribution cleared, the totals are 40.00 and 50.00. Factors affect the base split in either case; the fixed rebate is applied afterward.

Use **Remove** on an incorrect adjustment, review **Confirm invoice action**, and select **Remove adjustment**, then add its replacement. The note is shown in share details, so write it for the participant who will read the final calculation.

Adjustments can be added or removed after closure. Each saved change requires **Recalculate pool** before it affects the share rows. Review all adjustments before recalculating.

### Add an organizer expense

Use **Add invoice / amount** for a cost that belongs in the shared pool, such as a venue bill paid outside the participant
invoice workflow. You do not need an event registration to record it. You can leave the cost unassigned or identify
the participant who paid.

1. Open the pool in **Invoice pools**.
2. Select **Add invoice / amount**.
3. Enter a positive **Amount** with at most two decimal places.
4. Under **Paid by participant (optional)**, select the participant who paid, or keep **No participant — shared pool expense**.
5. Enter a required **Description** explaining the cost.
6. Under **Proof (optional)**, attach a receipt or invoice when available.
7. Select **Add expense** and wait for confirmation.

The invoice is immediately **Accepted** and included in pool costs in every pool state. The ledger shows the selected
participant, or **Pool expense** when unassigned, alongside **Recorded by** with the organizer's name. The participant
who paid and the organizer who recorded it are separate. When no proof was supplied, it shows **No proof attached**.
Proof remains optional for either choice and uses the same supported file types and 10 MiB limit as participant proofs.
Adding the invoice sends no creation email.

A confirmed validation error keeps your entries available for correction. If Surveyor cannot confirm whether the cost was saved, the form stays locked and offers **Reload and check saved invoices**. Check the ledger before adding the expense again; a lost response does not mean the cost was rejected.

The selector contains existing participants assigned to this pool; it does not add someone to the event or pool.
When **Deduct submitter invoices from their share** is enabled, an attributed invoice reduces that participant's share
or their covering payer's share. It also appears in the selected participant's **Your invoice history**, with access to
its receipt and the existing **Close** action on an Accepted invoice. The unassigned default creates no personal invoice
credit or participant history entry, including for an organizer who attends the event. Recorder identity alone never
determines reimbursement or receipt ownership.

You can add an organizer expense to a closed pool. Its saved shares and payments stay unchanged, and **Recalculation required** appears; preview and apply **Recalculate pool** to include the new cost. **Roll back pool changes** does not remove the saved expense or reverse its acceptance.

### Review submitted invoices

Expand the pool’s **Invoices** section to reach **Invoice administration**. It opens automatically for **Open for invoices** and **Organizer invoices only** pools, or when invoices await review. Newest submissions appear first.

Use:

- **Search invoices** to search invoice number, participant name or email, amounts, descriptions, corrections, or rejection reasons.
- **All statuses** to filter Awaiting review, Accepted, Rejected, Closed, or Retracted invoices.
- 25, 50, or 100 rows per page.
- **Previous** and **Next** to move through longer ledgers.

For each participant submission, compare **Submitted details** with **View proof**. The **Organizer review** column contains
the correction and rejection fields while the invoice is Awaiting review. **Participant / source** shows participant
attribution separately from an organizer's **Recorded by** label. Organizer-entered invoices are already Accepted,
can have no proof, and show **Pool expense** when no participant was selected.

#### Accept without correction

1. Leave **Corrected amount** empty.
2. Leave **Corrected description** empty.
3. Select **Accept**, review **Confirm invoice action**, then select **Accept** again.

The submitted amount and description become the effective accepted values.

#### Accept with a correction

1. Enter a positive **Corrected amount** when the accepted total differs from the submitted amount.
2. Enter a **Corrected description** when the accepted explanation should differ. It can contain up to 4,000 characters.
3. Select **Accept**, review **Confirm invoice action**, then select **Accept** again.

Surveyor preserves the original submission and displays it beside the correction. The corrected amount is used for pool totals, invoice credit, and final shares. A blank corrected field keeps the corresponding submitted value.

#### Reject

1. Enter a **Rejection reason**. It is required and can contain up to 4,000 characters.
2. Select **Reject**, review **Confirm invoice action**, then select **Reject** again.

The invoice becomes Rejected. It is excluded from totals but remains in both the organizer ledger and the submitter’s history with the reason and proof.

#### Close an accepted invoice

Select **Close** on an Accepted invoice when its review record is finished, then review and confirm **Close** in **Confirm invoice action**. The invoice becomes Closed but remains included in **Full pool total** and in the final share calculation. The action does not settle a participant share.

The attributed participant may also close their own Accepted invoice from **Your invoice history**, including one
recorded for them by an organizer.

#### Correct or reject an accepted or closed invoice

These actions apply to both participant invoices and organizer expenses, including in a closed pool.

To correct a counted cost:

1. Select **Correct** on an Accepted or Closed invoice.
2. In **Correct invoice**, check the effective **Amount** and **Description**, then enter a positive corrected amount or revise the description.
3. Select **Continue**.
4. Review **Confirm invoice change**, then select **Confirm correction**. **Back to edit** returns to the fields.

The original submission and proof are preserved. The corrected amount and description become the effective values, and the invoice keeps its Accepted or Closed status. Clearing the correction description restores the original description.

To remove a counted cost, select **Reject from pool**, enter a required **Rejection reason** in **Reject invoice from pool**, then select **Continue** and **Confirm rejection**. The invoice becomes Rejected and is excluded from pool costs and personal invoice credit. Its original details, proof, and existing correction remain in history.

For a closed pool, either change requires **Recalculate pool**. Existing shares and payments remain saved until you preview and apply the new calculation, which carries prior settlements forward. **Roll back pool changes** does not undo invoice corrections or rejections. If the pool changed after you opened the dialog, reload and review the invoice before confirming again.

#### Notifications and late review

When the attributed participant has an email address, Surveyor sends an acceptance, rejection, or closure message
with the organizer's displayed actor label. For an organizer-entered invoice, these existing review notifications
follow the selected participant rather than the recorder. The saved review is confirmed without waiting for email
delivery. If another organizer has already reviewed the same invoice, reload its saved status before taking another
action. Review actions remain available for an Awaiting-review invoice even if the pool has already been closed.
Accepting a cost after pool closure requires **Recalculate pool** before the new cost is represented in the frozen shares.

Resolve or consciously exclude every Awaiting-review invoice before closing the pool whenever possible. Closing a pool ignores Awaiting-review, Rejected, and Retracted invoices.

### Preview a calculation

1. Save the settings, participant factors, adjustments, and takeovers you want to use.
2. Select **Preview calculation**, or **Recalculate pool** for a closed pool.
3. Expand **Calculation breakdown** to review the pool's contextual numbers. Expand the separate **Example calculation** for the arithmetic, then check each payer's applicable components and Calculated balance.
4. Close the dialog to make further edits, or confirm the calculation when the amounts are correct.

Preview does not save shares, close the pool, change payment markers, or send emails. It uses the same calculation and settlement-credit rules as the final action. If someone changes inputs or records a payment after the preview, refresh the preview before applying it.

**Calculation breakdown** lists contextual numbers: saved cost amounts, the assigned participant count, applicable
days or nights, eligible units, exemptions, and total weight, alongside used surcharge and rebate categories and
relevant settlement totals. It contains no formulas or explanatory paragraphs. The separate, collapsed
**Example calculation** explains the total and base first, then shows a qualifying anonymous payer's arithmetic and
the rounding direction. If no payer qualifies, available saved cost arithmetic can still explain the pool totals
without introducing a person. Opposing surcharge and rebate totals remain visible even when their net effect is zero.
Duplicate amounts are omitted.
**Rounding difference** shows the small surplus or shortfall caused by the selected rounding direction. For example,
splitting 100.00 equally three ways gives 33.34 each when rounding up (100.02 total), or 33.33 each when rounding down
(99.99 total). Surveyor does not give otherwise equal participants different cents to force a matching total.

Rounding applies to each participant's base before takeover groups are combined. Surcharges, rebates, and invoice reimbursements keep their entered cent amounts. For negative base amounts, rounding up moves toward the greater amount: −33.333 becomes −33.33; rounding down gives −33.34.

#### Reconcile costs and reimbursements

**Full pool total** is the counted invoice cost plus signed on-top surcharges or rebates. **Base to distribute** is the
shared amount after redistributed surcharges or rebates have been taken into account. Redistribution changes who pays
the existing invoice cost; it does not change the full pool total. On-top adjustments change the full pool total and
the affected participant's balance while leaving the shared base unchanged. Without either adjustment mode, the relevant
amounts are equal. **Calculation breakdown** shows one cost figure; **Example calculation** explains the relationship.

The cost of the pool and the transfers still needed are different amounts. When **Deduct submitter invoices from their
share** is selected, invoice credits reduce each submitter's balance or their covering payer's balance. For example,
a base share of `80.00` and an invoice credit of `100.00` produce a calculated balance of `-20.00`: a refund to that payer.
Previously settled payments or refunds also affect the calculated balance, and are shown when applicable.

Factors and attendance decide each base portion; takeovers combine those portions and their adjustments. Check
exemptions, factors, attendance dates, and the participant selected for each adjustment when a result differs from
your expectation. After calculation, **View breakdown** retains the full signed trace for each payer.

### Close the pool and calculate shares

This final calculation is available from **Open for invoices** and **Organizer invoices only**. It creates saved
shares and closes the pool; stopping participant submissions alone does neither.

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

- Selects Accepted and Closed invoices and ignores Awaiting-review, Rejected, and Retracted invoices.
- Calculates the distributable total after signed redistributed adjustments.
- Divides the Base share by participant, inclusive-day, or night weights multiplied by individual factors.
- Gives exempt participants no automatic Base share.
- Adds participant-specific surcharges and negative rebates after the weighted split.
- Applies invoice credits when enabled.
- Combines beneficiaries into their covering payer.
- Creates one share row for each resulting payer.
- Shows **Payment due** for positive balances, **Refund due** for negative balances, and **No payment** for zero balances.
- Marks the pool **Closed**.
- Emails payers with an email address if **Email participants after this calculation** is selected.

The preview uses the same **Example calculation** as the organizer pool view and PDF. It first explains the pool totals
and base using the saved values, then chooses a positive payer who pays their own nonexempt share, preferring someone who covers nobody else and then
an example with applicable factors, adjustments, or credits. The choice stays consistent for the same saved data.
If only a covering payer qualifies, the introduction states how many other participants that example payer covers.
Names are fictional. Refunds, exempt payers, and zero balances are not presented as ordinary payment examples; when
no payer qualifies, available cost calculations remain as an example of the pool totals without an invented person.
If an older calculation has no numeric explanation data, contextual figures remain where available and no empty
example heading is shown. Missing historical inputs are never guessed from current settings.
Applicable adjustments, invoice credits, and previously settled amounts explain the calculated balance. **Payments due**
and signed **Refunds due** show how much must be collected or paid out; they are retained alongside applicable cost details.

A takeover combines the beneficiary’s already calculated Base share, adjustments, and Invoice credit into the payer’s row. The beneficiary keeps their own factor; the payer’s factor is not applied again. Each participant's Base is rounded consistently in the direction chosen by **Round base shares up**. The resulting surplus or shortfall remains visible in the preview.

### Recalculate a closed pool

Use **Recalculate pool** after settings, assignments, factors, exemptions, takeovers, surcharges, rebates, attendance dates, or accepted invoices changed. You can continue recording payments against the saved shares while the pool shows **Recalculation required**.

1. Correct and save the inputs.
2. Use **Record payment** or **Record refund** to record transfers already completed against the saved calculated balances.
3. Select **Recalculate pool** and review the preview.
4. Choose whether to **Email participants after this calculation**.
5. Select **Apply recalculation**.

Previously settled money becomes a credit against the new calculation. For example, someone who paid 100.00 and now owes a calculated share of 120.00 gets a **Calculated balance** of `20.00`. If the new calculated share is 80.00, their calculated balance is a refund of `-20.00`. If the old share had no recorded settlement, its amount is replaced by the newly calculated balance.

The credit carries across repeated recalculations exactly once. After settlement of the additional 20.00 is recorded, a later calculated share of 130.00 leaves 10.00 to pay. Refunds work the same way: a previously settled refund of `-30.00` against a revised refund of `-20.00` leaves `10.00` to collect back.

Payments stay with the person who made or received them. If a takeover changes the payer, or someone is removed from this pool but remains registered for the event, that person's existing payment can appear as a separate refund share. It is not silently transferred to another payer.

If a participant with recorded payments or refunds becomes exempt or covered by someone else, their saved share
shows **Exempt · settlement retained** or **Covered by … · settlement retained** while a correcting transfer is needed.
Record that refund or repayment, then recalculate to apply it. When the carried credit reaches zero, the indicator
clears: an exempt participant keeps their ordinary zero share and **Own share** caption; a former payer covered by
someone else no longer needs a separate row. These indicators describe the saved calculation; pending changes do not
replace them. The participant receives a **Your payment responsibility changed** email when
recalculation applies the exemption or changed coverage, even when general calculation emails are disabled.
Previously settled credits remain signed net amounts, rather than a complete chronological transfer ledger.

The pool stays closed and invoice review records are unchanged. A failed calculation preserves the old shares and payments. A changed input or payment revision requires a fresh preview. Save or **Discard edits** in open dialogs before calculating.

### Roll back pool changes

Use **Roll back pool changes** when you want to keep the last calculation instead of applying saved pool edits.

1. Open the closed pool marked **Recalculation required**.
2. Select **Roll back pool changes** and read the confirmation.
3. Select **Restore last calculated settings**, read the result, then select **Return to pool**.

Rollback restores the pool's description, distribution settings, rounding direction, email preference, assignments, factors, exemptions, surcharges/rebates, and takeovers from its last successful calculation. Existing shares and recorded payments are preserved. No calculation, settlement, or takeover email is sent.

Event registrations, attendance dates, invoice reviews, and organizer expenses are separate records. Rollback does not undo those changes, erase a saved organizer expense, or recreate deleted participants. If they changed since the last calculation, the pool may still require recalculation after its local settings are restored. Review the result message.

Rollback needs a saved calculation snapshot. Older closed pools without one gain it when they are next successfully recalculated. A snapshot from before the rounding setting was introduced restores with rounding up enabled and still requires recalculation. **Discard edits** only resets unsaved form fields; **Roll back pool changes** restores saved pool inputs. Rollback does not undo an already applied recalculation.
If an older snapshot has no saved coverage evidence, Surveyor leaves inputs and settlements unchanged and asks for a
successful calculation before rollback becomes available. It never guesses previous takeovers from current edits.

### Send settlement emails

**Send calculation emails automatically** in **Pool settings** controls the default. **Email participants after this calculation** lets you change the choice before closing or recalculating. Both start enabled for a new pool.
These choices control settlement messages; they do not disable notifications for coverage changes applied by a
successful recalculation.

To send updates afterward, open a closed pool, select **Send settlement emails**, and confirm. This works even if automatic emails are switched off. It sends to payers with an email address without recalculating, changing payment markers, or moving money.
The dialog closes when Surveyor confirms that the request succeeded. If the request fails or success is not confirmed,
it stays open with feedback.

Emails keep **Your calculated balance**, status, event and pool context, and **View your invoice pool** action near
the top. **Payment due**, **Refund due**, **Paid**, **Refunded**, or **No payment** describes the current status.
**Saved calculation notes** preserve the original recorded notes and authored descriptions, before and outside the
full **Calculation explanation**. Select **Calculation explanation** to expand it when your email app supports the
disclosure; other readers may show the full content directly.
The concrete calculation uses your name and any covered participants' names to show each actual base share and all
applicable balance components. The saved notes are preserved rather than replaced or rewritten. Plain-text emails
always include the complete explanation and notes.
If inputs have changed, the message describes the previous saved calculation.
Delivery depends on the installation's mail service.

### Record whether a share is settled

After closure, **Shares & settlement** contains the **Calculated shares** ledger. Each row shows the **Payer**,
the signed **Calculated balance**, and a compact payment/refund status. Status describes
the named payer. **View breakdown** opens applicable saved components, saved notes, and the concrete
**Calculation explanation**. Expand the pool's separate **Example calculation** for total/base arithmetic and an
anonymous payer example when one applies. **Calculation breakdown** lists the pool-wide contextual numbers and
relevant settlement totals without formulas or explanations.
Phones and tablets show the same information as cards. Saved shares stay available while recalculation is required.

**Filter share status** offers **All statuses**, **Payment due**, **Refund due**, and
**Settled**. Use **Search shares**, **Sort shares**, **Shares per page**, **Previous**,
and **Next** to navigate. Recording a transfer updates status while keeping the calculated balance and current row
order. **Refresh list** reapplies filters and ordering; it is highlighted after a status change under an active filter.

After the real-world transfer is complete:

1. Check the payer and signed **Calculated balance**.
2. Select **Record payment** for a positive balance or **Record refund** for a negative balance.
3. Review **Confirm invoice action**, including the amount and transfer direction.
4. Select **Record payment** or **Record refund** again and wait for confirmation.

**Cancel**, the close button, Escape, and backdrop dismissal leave saved state unchanged. The review initially focuses
**Cancel**. Scrolling over a focused invoice number field does not step its draft amount.

The pending action displays a spinner. Success shows **Paid** or **Refunded**, retains the signed
calculated balance, and updates **Payments due** or **Refunds due**.
Wait for the result before another action. Surveyor emails the payer when an address is available.

Use **Undo payment** or **Undo refund**, review the signed amount, and confirm the same action to correct a mistaken
record. This restores **Payment due** or **Refund due** while retaining the calculated balance
and credits carried from earlier calculations. Undo mistaken records before applying a new calculation.

### Export saved shares as a PDF

1. Open the pool's **Calculated shares** ledger.
2. Select **Export shares PDF with example** or **Export shares PDF without example**.
3. Save or print the portrait A4 document.

Both PDF choices start with **Calculation breakdown**, listing saved contextual numbers: relevant cost amounts, used
signed adjustment categories, and applicable assigned-participant, day/night, eligible-unit, exemption, and total-weight
figures. It contains no formulas or explanatory paragraphs. These figures remain available independently of any example.
Ordinary pools without adjustments use one cost figure instead of repeating equal cost scopes.

**Export shares PDF with example** adds the same **Example calculation** as the organizer pool view and preview.
It explains the full total and shared base using actual saved numbers and only the adjustment modes used. A qualifying
anonymous payer then demonstrates applicable attendance, share factor, total weight, the rounded base share, and
balance components. It prefers an ordinary payer with no beneficiaries.
Within that group it prefers a payer with a redistributed surcharge, which shows how the surcharge reduces the shared
base and is then added to the affected share without increasing the full pool total.
If a covering payer is needed, the introduction gives the number of other participants covered before explaining the
combined base share. The example is distinct from the concrete personal explanation in **View breakdown** and emails.
Older calculations retain saved amounts and notes without guessing unavailable inputs. When no positive payer with
saved contribution evidence qualifies, usable saved cost arithmetic can still explain the pool totals without
introducing a person. Entirely missing numeric explanation data produces no example heading.

**Export shares PDF without example** contains contextual figures, shares, original factual notes, settlement status
and dates, and transfer totals. It includes no calculation explanations or formulas. Applicable attendance and
distribution figures remain in **Calculation breakdown**. A stale compact export uses the short **Recalculation required**
label. Its saved shares and settlement totals are the same as in the version with an example.

The table includes every saved share in the pool, regardless of the screen's search, status filter, sort, or page.
Each payer's applicable component amounts, signed **Calculated balance**, status, and saved notes appear without repeating the
formula or balance below every row. Recorded settlements use **Paid** or **Refunded** and include the settlement date
when available. **Saved settlement totals** keep **Payments due** and signed **Refunds due** for transfers still to
record, alongside applicable invoice credits, previously settled credits, and **Payments received** or negative
**Refunds paid** recorded in this calculation. Settled amounts are excluded from the due totals, while their original
calculated balance stays visible. If **Recalculation required**
is shown, the exported shares come from the previous saved calculation. Exporting does not recalculate the pool or change
payments.

Export requires invoice-pool administration access. Treat the downloaded file as financial participant data and share it only with authorized recipients.

## Privacy, proof access, storage, and retention

Invoice data is sensitive. A proof file may contain personal addresses, bank or card information, tax identifiers, itemized purchases, or third-party names.

- Participants can view their own invoice history and proofs.
- Organizers with **Manage Assignments** can view every invoice and proof in the event’s invoice pools.
- Unassigned organizer expenses and their optional proofs appear in the organizer ledger without a participant history entry. If an organizer selects **Paid by participant (optional)**, the invoice and its optional receipt also appear in that participant's own history under the existing access rules. The recorded organizer name remains independently on the invoice if its profile is later deleted.
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

Only Accepted and Closed invoices count. Awaiting-review, Rejected, and Retracted invoices are excluded. Ask an organizer to review an invoice still awaiting review. If the pool is already closed, the organizer must also recalculate the pool before the frozen shares include a newly accepted cost.

### My accepted amount or description changed

Organizers can correct an amount or description when accepting an invoice and can confirm later corrections while it is Accepted or Closed. Your history preserves and displays the original submission. Contact the organizer when the correction is unexpected.

### I cannot select somebody in **Manage takeovers**

The person must be assigned to the same open pool. You cannot select yourself, a participant already covered by another payer, or a participant whose covered/covering relationship would create a chain. Ask an organizer to reassign an existing takeover.

### A share is different from the simple equal split

Check the pool’s distribution mode, attendance dates, individual factors, exemptions, redistributed and on-top adjustments, invoice-credit setting, and takeovers. Open **View breakdown** to read the **Saved calculation notes** and saved numeric inputs.

### The pool changed but the shares did not

A closed pool's calculation stays saved until you apply a recalculation. Save changes in the relevant dialog, then preview and recalculate, or use **Roll back pool changes** to restore saved pool inputs. **Record payment** and **Record refund** remain available for the saved balances throughout.

### A recalculated share requires payment although I already paid

Check **Previously settled** and **Calculated balance** in **View breakdown**. Prior payments reduce the new balance;
only the new difference needs settlement. A zero balance shows **No payment**. A refund has a negative calculated balance.

### An expected email did not arrive

Notifications require an email address on the participant’s account or guest profile and working email delivery for the Surveyor installation. Check spam folders, confirm the profile email, and ask the operator to review mail delivery when several recipients are affected.

### A proof is unavailable

Check that you are opening your own invoice or are an authorized invoice-pool organizer. The proof may also have reached the installation’s retention cutoff. Organizers should contact the operator rather than exchanging sensitive proofs through an unapproved channel.

---

**Related guides:** [Events](EVENTS.md) · [Permissions and Sharing](PERMISSIONS.md) · [Getting Started](GETTING_STARTED.md)

**Back to:** [User Guide Home](README.md)
