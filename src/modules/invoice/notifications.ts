/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {invoiceLabels, invoiceText} from './wording';
import type {Request} from 'express';
import type {Event} from '../database/entities/event/Event';
import type {EventInvoice} from '../database/entities/event/EventInvoice';
import type {EventInvoicePool} from '../database/entities/event/EventInvoicePool';
import {formatInvoiceMoney, presentInvoiceShare, invoiceSettledShareNotice} from './presentation';
import {buildInvoiceSettlementEmail} from './settlementEmail';
import type {EventInvoiceShare} from '../database/entities/event/EventInvoiceShare';
import type {Profile} from '../database/entities/user/Profile';
import type {ParticipantRow} from '../../types/EventTypes';
import mailer, {resolveEmailRecipientName} from '../email';
import type {EmailContent, EmailRecipient} from '../../types/EmailTypes';
import {resolveInvoiceAmount, resolveActorLabel, toAmount} from '../lib/util';
import settings from '../settings';
import type {InvoiceTakeoverChanges, InvoiceSettlementNotice, InvoiceSettlementNotificationSelection} from '../../types/InvoicePoolTypes';

/** Resolve the canonical event URL used by invoice notification actions. */
function eventPageUrl(event: Event): string {
    return `${settings.value.rootUrl.replace(/\/$/, '')}/event/${encodeURIComponent(event.id)}`;
}

// Financial mutations must finish before this is called. Delivery never changes their outcome.
/** Queue notification delivery after commit without making SMTP part of mutation success. */
function queueInvoiceEmail(recipient: EmailRecipient, subject: string, content: EmailContent): void {
    // SMTP failures are reported after commit and cannot turn a saved financial change into a failure.
    /** Report a post-commit delivery or background failure without changing the saved financial result. */
    function reportFailure(error: unknown): void { console.error(invoiceText('notificationDeliveryFailed'), error); }
    try {
        void mailer.sendEmail(recipient, subject, content).catch(reportFailure);
    } catch (error) {
        reportFailure(error);
    }
}

/** Resolve a named mail recipient from saved profile and account attribution. */
function invoiceEmailRecipient(profile: Profile, address: string): EmailRecipient {
    return {name: resolveEmailRecipientName(profile.name, profile.user?.name, profile.user?.username, profile.guest?.username), address};
}

/** Select participant or organizer attribution without creating event membership. */
function invoiceContactProfile(invoice: EventInvoice): Profile | null | undefined {
    return invoice.registration?.profile ?? invoice.recordedByProfile;
}

// Send both payer and beneficiary emails when takeover mappings change, including the actor for traceability.
/** Describe a committed coverage diff once per payer and beneficiary recipient. */
export async function notifyTakeoverChanges(
    event: Event,
    pool: EventInvoicePool,
    changes: InvoiceTakeoverChanges,
    actorLabel: string,
    participants: ParticipantRow[],
) {
    // Empty diffs do not notify. Participant rows are supplied by the controller after commit.
    if ((!changes.added?.length) && (!changes.removed?.length)) return;
    const map = new Map(participants.map((p) => [Number(p.id), p]));
    const queue = new Map<number, {recipient: EmailRecipient; messages: string[]}>();
    // Aggregate all changes per recipient so a coverage edit sends one coherent notification.
    /** Accumulate each recipient’s coverage changes for one coherent notification. */
    function enqueue(participant: ParticipantRow | undefined, message: string): void {
        if (!participant?.email || participant.email === '—') return;
        const id = Number(participant.id);
        const existing = queue.get(id) || {recipient: {name: participant.name, address: participant.email}, messages: []};
        existing.messages.push(message);
        queue.set(id, existing);
    }

    // Explain coverage additions to both parties, using the same participant-name fallback.
    for (const add of changes.added || []) {
        const payer = map.get(add.payerId);
        const beneficiary = map.get(add.beneficiaryId);
        const beneficiaryName = beneficiary?.name || invoiceText('participant', {id: add.beneficiaryId});
        const payerName = payer?.name || invoiceText('participant', {id: add.payerId});
        enqueue(
            payer,
            invoiceText('youAreNowCovering', {beneficiaryName: beneficiaryName}),
        );
        enqueue(
            beneficiary,
            invoiceText('coverageAddedForBeneficiary', {payerName}),
        );
    }

    // Explain removals separately so a reassigned beneficiary can trace both payer changes.
    for (const remove of changes.removed || []) {
        const payer = map.get(remove.payerId);
        const beneficiary = map.get(remove.beneficiaryId);
        const beneficiaryName = beneficiary?.name || invoiceText('participant', {id: remove.beneficiaryId});
        const payerName = payer?.name || invoiceText('participant', {id: remove.payerId});
        enqueue(
            payer,
            invoiceText('youAreNoLongerCovering', {beneficiaryName: beneficiaryName}),
        );
        enqueue(
            beneficiary,
            invoiceText('coverageRemovedForBeneficiary', {payerName}),
        );
    }

    // Recipients are deduplicated; dispatch happens only after the takeover transaction committed.
    for (const {messages, recipient} of queue.values()) {
        queueInvoiceEmail(recipient, invoiceText('invoiceTakeoversUpdated'), {
            eyebrow: invoiceText('emailYourPool'),
            heading: invoiceText('paymentCoverageWasUpdated'),
            preheader: invoiceText('paymentCoverageChangedFor', {name: pool.name}),
            paragraphs: [invoiceText('thePaymentResponsibilitiesInAnInvoicePoolHaveChanged')],
            details: [
                {label: invoiceText('emailYourEvent'), value: event.title},
                {label: invoiceText('emailYourPool'), value: pool.name},
                {label: invoiceText('emailUpdatedBy'), value: actorLabel},
            ],
            sections: [{title: invoiceText('whatChanged'), items: messages}],
            action: {label: invoiceText('emailViewYourInvoicePool'), url: eventPageUrl(event)},
        });
    }
}

/** Explain a committed correction, rejection, or retraction without changing its saved history. */
export function notifySavedInvoiceChange(event: Event, pool: EventInvoicePool, before: EventInvoice, saved: EventInvoice,
    action: 'corrected' | 'rejected' | 'retracted', session: Request['session']): void {
    // Resolve the saved submitter or organizer attribution; an absent address simply suppresses delivery.
    const contact = invoiceContactProfile(before);
    const email = contact?.user?.email || contact?.guest?.email;
    if (!contact || !email) return;
    // Status codes select whole messages, never English verbs inserted into translated sentences.
    const messages = {
        corrected: {subject: 'correctedInvoiceSubject', heading: 'correctedInvoiceHeading'},
        rejected: {subject: 'invoiceRejected', heading: 'rejectedInvoiceHeading'},
        retracted: {subject: 'retractedInvoiceSubject', heading: 'retractedInvoiceHeading'},
    } as const;
    queueInvoiceEmail(invoiceEmailRecipient(contact, email), invoiceText(messages[action].subject), {
        eyebrow: invoiceText('yourInvoiceHistory'),
        heading: invoiceText(messages[action].heading),
        paragraphs: [action === 'corrected'
            ? invoiceText('anOrganizerChangedTheAcceptedDetailsUsedForThe')
            : action === 'rejected'
                ? invoiceText('anOrganizerRemovedThisInvoiceFromTheCostsAnd')
                : invoiceText('yourInvoiceWasWithdrawnBeforeOrganizerReviewItRemains')],
        details: [
            {label: invoiceText('emailYourInvoice'), value: `#${saved.id}`},
            {label: invoiceText('emailYourEvent'), value: event.title},
            {label: invoiceText('emailYourPool'), value: pool.name},
            {label: invoiceText('emailYourOriginalAmount'), value: formatInvoiceMoney(toAmount(saved.amount))},
            ...(action === 'corrected' ? [
                {label: invoiceText('emailYourPreviousCountedAmount'), value: formatInvoiceMoney(resolveInvoiceAmount(before.amount, before.correctedAmount))},
                {label: invoiceText('emailYourUpdatedCountedAmount'), value: formatInvoiceMoney(resolveInvoiceAmount(saved.amount, saved.correctedAmount))},
                {label: invoiceText('emailYourUpdatedDescription'), value: saved.correctedDescription ?? saved.description ?? '—'},
            ] : []),
            ...(action === 'rejected' ? [{label: invoiceText('emailYourRejectionReason'), value: saved.rejectionReason || '—'}] : []),
            {label: invoiceText('emailUpdatedBy'), value: resolveActorLabel(session)},
        ],
        action: {label: invoiceText('emailViewYourInvoiceHistory'), url: eventPageUrl(event)},
        notice: action === 'retracted'
            ? invoiceText('thisInvoiceWasNeverCountedInSharesRetractionDoes')
            : invoiceText('savedSharesAndRecordedPaymentsStayUnchangedUntilThe'),
    });
}

/** Prepare and queue this notification only after persistence has confirmed the change. */
export function notifyAcceptedInvoice(event: Event, pool: EventInvoicePool, invoice: EventInvoice, correctedAmount: number | null, correctedDescription: string | null, session: Request['session']): void {
    // Resolve the saved submitter or organizer attribution; an absent address simply suppresses delivery.
    const contact = invoiceContactProfile(invoice);
    const email = contact?.user?.email || contact?.guest?.email;
    if (email && contact) {
        const actor = resolveActorLabel(session);
        // Show the effective accepted amount alongside submitted evidence only when corrections were supplied.
        const acceptedAmount = formatInvoiceMoney(resolveInvoiceAmount(invoice.amount, correctedAmount));
        const correctionDetails = [
            ...(correctedAmount !== null
                ? [{label: invoiceText('emailYourSubmittedAmount'), value: formatInvoiceMoney(Number(invoice.amount))}]
                : []),
            ...(correctedDescription
                ? [{label: invoiceText('emailYourOrganizerCorrection'), value: correctedDescription}]
                : []),
        ];
        // Queue the catalog-rendered message after commit; SMTP availability cannot roll back the saved change.
        queueInvoiceEmail(
            invoiceEmailRecipient(contact, email),
            invoiceText('invoiceAccepted'),
            {
                eyebrow: invoiceText('invoiceAccepted'),
                heading: invoiceText('yourInvoiceWasAccepted'),
                preheader: invoiceText('invoiceWasAcceptedFor', {id: invoice.id, acceptedAmount: acceptedAmount}),
                paragraphs: [invoiceText('anOrganizerReviewedAndAcceptedYourInvoiceItWill')],
                details: [
                    {label: invoiceText('emailYourInvoice'), value: `#${invoice.id}`},
                    {label: invoiceText('emailYourEvent'), value: event.title},
                    {label: invoiceText('emailYourPool'), value: pool.name},
                    {label: invoiceText('emailYourAcceptedAmount'), value: acceptedAmount},
                    {label: invoiceText('emailReviewedBy'), value: actor},
                    ...correctionDetails,
                ],
                action: {label: invoiceText('emailViewYourInvoiceHistory'), url: eventPageUrl(event)},
            },
        );
    }
}

/** Prepare and queue this notification only after persistence has confirmed the change. */
export function notifyClosedInvoice(event: Event, pool: EventInvoicePool, invoice: EventInvoice, session: Request['session']): void {
    // Resolve the saved submitter or organizer attribution; an absent address simply suppresses delivery.
    const contact = invoiceContactProfile(invoice);
    const email = contact?.user?.email || contact?.guest?.email;
    if (email) {
        const actor = resolveActorLabel(session);
        // Queue the catalog-rendered message after commit; SMTP availability cannot roll back the saved change.
        queueInvoiceEmail(
            invoiceEmailRecipient(contact!, email),
            invoiceText('invoiceClosed'),
            {
                eyebrow: invoiceText('invoiceUpdate'),
                heading: invoiceText('yourInvoiceWasClosed'),
                preheader: invoiceText('invoiceWasMarkedAsClosed', {id: invoice.id}),
                paragraphs: [invoiceText('yourAcceptedInvoiceHasBeenMarkedAsClosedIt')],
                details: [
                    {label: invoiceText('emailYourInvoice'), value: `#${invoice.id}`},
                    {label: invoiceText('emailYourEvent'), value: event.title},
                    {label: invoiceText('emailYourPool'), value: pool.name},
                    {label: invoiceText('emailUpdatedBy'), value: actor},
                ],
                action: {label: invoiceText('emailViewYourInvoiceHistory'), url: eventPageUrl(event)},
            },
        );
    }
}

/** Prepare and queue this notification only after persistence has confirmed the change. */
export function notifyRejectedInvoice(event: Event, pool: EventInvoicePool, invoice: EventInvoice, rejectionReason: string, session: Request['session']): void {
    // Resolve the saved submitter or organizer attribution; an absent address simply suppresses delivery.
    const contact = invoiceContactProfile(invoice);
    const email = contact?.user?.email || contact?.guest?.email;
    if (email) {
        const actor = resolveActorLabel(session);
        // Queue the catalog-rendered message after commit; SMTP availability cannot roll back the saved change.
        queueInvoiceEmail(
            invoiceEmailRecipient(contact!, email),
            invoiceText('invoiceRejected'),
            {
                eyebrow: invoiceText('invoiceRejected'),
                heading: invoiceText('yourInvoiceNeedsAttention'),
                preheader: invoiceText('invoiceWasRejectedByAnOrganizer', {id: invoice.id}),
                paragraphs: [invoiceText('anOrganizerCouldNotAcceptThisInvoiceTheInvoice')],
                details: [
                    {label: invoiceText('emailYourInvoice'), value: `#${invoice.id}`},
                    {label: invoiceText('emailYourEvent'), value: event.title},
                    {label: invoiceText('emailYourPool'), value: pool.name},
                    {label: invoiceText('emailReviewedBy'), value: actor},
                    {label: invoiceText('emailYourRejectionReason'), value: rejectionReason},
                ],
                action: {label: invoiceText('emailViewYourInvoiceHistory'), url: eventPageUrl(event)},
                notice: invoiceText('ifYouNeedClarificationContactAnEventOrganizerBefore'),
            },
        );
    }
}

/** Prepare and queue this notification only after persistence has confirmed the change. */
export function notifyShareSettlement(event: Event, pool: EventInvoicePool, share: EventInvoiceShare, isPaid: boolean, session: Request['session']): void {
    // Settlement notices address the actual payer, preserving the signed saved calculated balance.
    const email = share.registration.profile.user?.email || share.registration.profile.guest?.email;
    if (email) {
        // Project the confirmed status without mutating the saved entity passed by the controller.
        const settlement = presentInvoiceShare({...share, isPaid});
        const actor = resolveActorLabel(session);
        // Queue the catalog-rendered message after commit; SMTP availability cannot roll back the saved change.
        queueInvoiceEmail(
            invoiceEmailRecipient(share.registration.profile, email),
            invoiceText('shareStatusChanged'),
            {
                eyebrow: invoiceText('emailYourStatus'),
                heading: invoiceText('settlementHeading', {amount: formatInvoiceMoney(settlement.originalBalance), status: settlement.statusLabel}),
                preheader: invoiceText('thePaymentStatusForChanged', {name: pool.name}),
                paragraphs: [invoiceText('thePaymentStatusOfYourInvoicePoolShareHas')],
                details: [
                    {label: invoiceText('emailYourEvent'), value: event.title},
                    {label: invoiceText('emailYourPool'), value: pool.name},
                    {label: invoiceText('emailYourStatus'), value: settlement.statusLabel},
                    {label: invoiceText('emailYourCalculatedBalance'), value: formatInvoiceMoney(settlement.originalBalance)},
                    {label: invoiceText('emailYourRecordedSettlement'), value: formatInvoiceMoney(settlement.settledAmount)},
                    {label: invoiceText('emailYourUnsettledBalance'), value: formatInvoiceMoney(settlement.remainingAmount)},
                    {label: invoiceText('emailUpdatedBy'), value: actor},
                ],
                action: {label: invoiceText('emailViewYourInvoicePool'), url: eventPageUrl(event)},
            },
        );
    }
}

/** Queue the submitter receipt from the saved invoice without holding the upload response for SMTP. */
export function notifySubmittedInvoice(event: Event, pool: EventInvoicePool, invoice: EventInvoice | null, value: {amount: number; description?: string}): void {
    // A missing hydrated record cannot produce a receipt; its successfully saved upload remains authoritative.
    if (!invoice) return;
    const invoiceId = invoice.id;
    const email = invoice?.registration?.profile.user?.email || invoice?.registration?.profile.guest?.email;
    if (email && invoice?.registration) {
        // Receipt delivery must not hold the successful upload response open for SMTP.
        // Queue the catalog-rendered message after commit; SMTP availability cannot roll back the saved change.
        queueInvoiceEmail(
            invoiceEmailRecipient(invoice.registration.profile, email),
            invoiceText('invoiceSubmitted'),
            {
                eyebrow: invoiceText('invoiceReceived'),
                heading: invoiceText('yourInvoiceWasSubmitted'),
                preheader: invoiceText('invoiceIsAwaitingOrganizerReview', {invoiceId: invoiceId}),
                paragraphs: [invoiceText('weReceivedYourInvoiceSuccessfullyAnOrganizerWillReview')],
                details: [
                    {label: invoiceText('emailYourInvoice'), value: `#${invoiceId}`},
                    {label: invoiceText('emailYourEvent'), value: event.title},
                    {label: invoiceText('emailYourPool'), value: pool.name},
                    {label: invoiceText('emailYourSubmittedAmount'), value: formatInvoiceMoney(Number(value.amount))},
                    {label: invoiceText('emailYourInvoiceStatus'), value: invoiceLabels.awaitingReview},
                    ...(value.description ? [{label: invoiceText('emailYourDescription'), value: String(value.description)}] : []),
                ],
                action: {label: invoiceText('emailViewYourInvoiceHistory'), url: eventPageUrl(event)},
                notice: invoiceText('youWillReceiveAnotherEmailWhenAnOrganizerAccepts'),
            },
        );
    }
}

/** Render the saved shares and queue one localized notice for each reachable payer. */
export function notifyPoolShareSettlements(event: Event, pool: EventInvoicePool, participants: Map<number, ParticipantRow>,
    reason: InvoiceSettlementNotice['reason'], session?: Request['session'], selection: InvoiceSettlementNotificationSelection = {}): {count: number} {
    let count = 0;
    const included = selection.registrationIds ? new Set(selection.registrationIds) : null;
    const excluded = new Set(selection.excludedRegistrationIds || []);
    const participantRows = [...participants.values()];
    // Use saved rows and provenance only, even when newer pool inputs are awaiting recalculation.
    for (const share of pool.shares || []) {
        // Explicit responsibility notices select impacted payers; optional bulk mail excludes them to avoid duplicates.
        if (included && !included.has(share.registrationId) || excluded.has(share.registrationId)) continue;
        const participant = participants.get(share.registrationId);
        const email = participant?.email;
        if (!participant || !email || email === '—') continue;
        const content = buildInvoiceSettlementEmail({
            eventTitle: event.title,
            poolName: pool.name,
            eventUrl: eventPageUrl(event),
            actor: resolveActorLabel(session),
            reason,
            needsRecalculation: !!pool.needsRecalculation,
            explanation: pool.calculationSnapshot?.explanation,
            savedAdjustments: pool.calculationSnapshot?.surcharges,
            payerName: participant.name,
            settledShareNotice: invoiceSettledShareNotice(pool, share, participantRows, 'participant'),
            share,
        });
        // Queue delivery without making SMTP availability part of calculation success.
        const subject = reason === 'responsibility-changed' ? invoiceText('settledShareResponsibilityChanged')
            : reason === 'closed' ? invoiceText('invoicePoolClosed')
                : reason === 'recalculated' ? invoiceText('invoicePoolRecalculated') : invoiceText('invoicePoolSettlement');
        queueInvoiceEmail({name: participant.name, address: email}, subject, content);
        count++;
    }
    return {count};
}
