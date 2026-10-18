/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import {invoiceLabels, invoiceText} from './wording';
import type {EmailSection, StructuredEmailContent} from '../../types/EmailTypes';
import type {InvoiceCalculationDisplay, InvoiceSettlementNotice} from '../../types/InvoicePoolTypes';
import {formatInvoiceMoney, presentInvoiceShare, invoicePayerCalculation, invoiceShareComponents, invoiceRecipientComponentLabel} from './presentation';

/** Adapt the payer's full structured explanation to the shared email renderer without flattening its arithmetic. */
function calculationSections(calculation: InvoiceCalculationDisplay): EmailSection[] {
    const sections: EmailSection[] = [];
    // The containing disclosure owns the overall title; each concrete step keeps its own localized heading.
    for (const section of calculation.sections) {
        sections.push({
            title: section.title,
            paragraphs: section.description ? [section.description] : [],
            details: section.metrics,
            formula: section.formula,
            items: section.items,
        });
    }
    // Legacy calculations can omit numerical inputs; their saved notes remain a separate evidence section.
    return sections;
}

/** Describe the persisted settlement, including money already received or paid out. */
export function buildInvoiceSettlementEmail(input: InvoiceSettlementNotice): StructuredEmailContent {
    const {share} = input;
    // The balance belongs to the saved calculation. Status records whether the payer has settled it.
    const presentation = presentInvoiceShare(share);
    const remaining = presentation.remainingAmount;
    const settled = remaining === 0;
    const money = formatInvoiceMoney;
    // The persisted note contains the actual recorded facts and authored descriptions. Preserve each
    // saved item exactly, including names and original wording; never synthesize or rewrite this history.
    // Its established bullet separator controls presentation only, and the shared renderer escapes its text.
    const notes = (share.note || '').split(' • ').filter(Boolean);
    // Personal notices explain the actual payer and every covered contribution, never the pool's anonymous example.
    const calculation = invoicePayerCalculation(input.explanation, {...share, payerName: input.payerName}, input.savedAdjustments);
    // Select a complete translated introduction so sentence order remains under the locale's control.
    const introduction = input.reason === 'responsibility-changed'
        ? invoiceText('settledShareResponsibilityChangedIntroduction')
        : input.reason === 'closed'
        ? invoiceText('theInvoicePoolHasBeenClosedAndYourShare')
        : input.reason === 'recalculated'
            ? invoiceText('theInvoicePoolHasBeenRecalculatedPreviouslyRecordedPayments')
            : invoiceText('anOrganizerRequestedAnUpdateOnYourSavedInvoice');
    // Staleness is material context for the visible balance, so explain it before the action rather than below the disclosure.
    const staleContext = input.needsRecalculation ? invoiceText('poolInputsHaveChangedSinceThisCalculationTheseAmounts') : undefined;
    // Select only applicable saved components. The heading already shows the calculated balance.
    const componentDetails = [];
    for (const component of invoiceShareComponents(share, input.explanation, input.savedAdjustments)) {
        if (component.key !== 'shareAmount') componentDetails.push({label: invoiceRecipientComponentLabel(component.key), value: money(component.amount)});
    }
    const explanationSections = calculationSections(calculation);
    // Keep the calculated balance primary and settlement status explicit, without derived or duplicate rows.
    return {
        eyebrow: invoiceText('invoicePoolSettlement'),
        heading: invoiceText('settlementHeading', {amount: money(presentation.originalBalance), status: presentation.statusLabel}),
        preheader: invoiceText('settlementPreheader', {poolName: input.poolName, amount: money(presentation.originalBalance), status: presentation.statusLabel}),
        paragraphs: [introduction, ...(input.settledShareNotice ? [input.settledShareNotice.description] : []),
            ...(settled ? [invoiceText('noPaymentOrRefundIsCurrentlyOutstandingForThis')] : []),
            ...(staleContext ? [staleContext] : [])],
        details: [
            {label: invoiceText('emailYourEvent'), value: input.eventTitle},
            {label: invoiceText('emailYourPool'), value: input.poolName},
            {label: invoiceText('emailYourStatus'), value: presentation.statusLabel},
            ...componentDetails,
            {label: invoiceText('emailUpdatedBy'), value: input.actor},
        ],
        // Original saved facts stay visible first, outside the optional arithmetic disclosure. The user's
        // historical wording is deliberately preserved independently of the recipient-addressed email copy.
        sections: notes.length ? [{title: invoiceLabels.calculationNotes, items: notes}] : [],
        sectionGroups: [{title: calculation.title, sections: explanationSections, disclosure: true}],
        action: {label: invoiceText('emailViewYourInvoicePool'), url: input.eventUrl},
        actionPosition: 'beforeSections',
        // The earlier stale context already scopes this calculation; avoid repeating that warning at the bottom.
        notice: input.needsRecalculation ? undefined : invoiceText('settlementNotice'),
    };
}
