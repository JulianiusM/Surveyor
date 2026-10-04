/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import {englishInvoiceCatalog} from './locales/en';
import type {InvoiceCatalog, InvoiceTextKey, InvoiceTextParameters} from '../../types/InvoicePoolTypes';

const invoiceCatalogs: Readonly<Record<string, InvoiceCatalog>> = {en: englishInvoiceCatalog};

/** Resolve both wording and plural rules to the same supported language. */
function invoiceLocale(locale: string): string {
    const normalized = locale.toLowerCase();
    if (normalized in invoiceCatalogs) return normalized;
    const language = normalized.split('-')[0];
    return language in invoiceCatalogs ? language : 'en';
}

/** Select a supported language with a predictable English fallback. */
export function getInvoiceCatalog(locale = 'en'): InvoiceCatalog {
    // Regional language variants may share the base-language catalog; unsupported languages use English.
    return invoiceCatalogs[invoiceLocale(locale)];
}

/** Format a whole translated message using named values instead of English sentence fragments. */
export function invoiceText(key: InvoiceTextKey, parameters: InvoiceTextParameters = {}, locale = 'en'): string {
    // Catalog lookup precedes interpolation so translations control grammar and placeholder order.
    const selectedLocale = invoiceLocale(locale);
    const entry = invoiceCatalogs[selectedLocale][key];
    // Plural messages keep complete sentences in the catalog, including languages with more than
    // two plural forms. They never append an English suffix to a translated participant or payer.
    const count = Number(parameters.count ?? 0);
    const message = typeof entry === 'string' ? entry
        : entry[new Intl.PluralRules(selectedLocale).select(count)] ?? entry.other;
    // Replace only our named placeholders. Values remain plain text for escaped Pug and DOM rendering.
    /** Interpolate a required named message value as plain text for escaped rendering. */
    function substitute(_placeholder: string, name: string): string {
        if (!(name in parameters)) throw new Error(invoiceText('missingTranslationParameter', {name}, locale));
        return String(parameters[name]);
    }
    return message.replace(/\{([A-Za-z]\w*)\}/g, substitute);
}

/** Keep label access readable while all wording remains owned by the selected catalog. */
export function getInvoiceLabels(locale = 'en') {
    // This stable presentation contract selects catalog keys once; views and clients do not supply fallback labels.
    return {
        payer: invoiceText('payer', {}, locale),
        base: invoiceText('base', {}, locale),
        adjustments: invoiceText('adjustments', {}, locale),
        invoiceCredit: invoiceText('invoiceCredit', {}, locale),
        calculated: invoiceText('calculated', {}, locale),
        previous: invoiceText('previous', {}, locale),
        original: invoiceText('original', {}, locale),
        settled: invoiceText('settled', {}, locale),
        remaining: invoiceText('remaining', {}, locale),
        due: invoiceText('due', {}, locale),
        refund: invoiceText('refund', {}, locale),
        settledStatus: invoiceText('settledStatus', {}, locale),
        paymentCompleted: invoiceText('paymentCompleted', {}, locale),
        refundCompleted: invoiceText('refundCompleted', {}, locale),
        settledFilter: invoiceText('settledFilter', {}, locale),
        recordPayment: invoiceText('recordPayment', {}, locale),
        recordRefund: invoiceText('recordRefund', {}, locale),
        reversePayment: invoiceText('reversePayment', {}, locale),
        reverseRefund: invoiceText('reverseRefund', {}, locale),
        paymentsDue: invoiceText('paymentsDue', {}, locale),
        refundsDue: invoiceText('refundsDue', {}, locale),
        netRemaining: invoiceText('netRemaining', {}, locale),
        invoiceCosts: invoiceText('invoiceCosts', {}, locale),
        redistributedAdjustments: invoiceText('redistributedAdjustments', {}, locale),
        additionalAdjustments: invoiceText('additionalAdjustments', {}, locale),
        distributable: invoiceText('distributable', {}, locale),
        baseCalculation: invoiceText('baseCalculation', {}, locale),
        calculationNotes: invoiceText('calculationNotes', {}, locale),
        recordSettlement: invoiceText('recordSettlement', {}, locale),
        reverseSettlement: invoiceText('reverseSettlement', {}, locale),
        awaitingReview: invoiceText('awaitingReview', {}, locale),
        accepted: invoiceText('accepted', {}, locale),
        rejected: invoiceText('rejected', {}, locale),
        retracted: invoiceText('retracted', {}, locale),
        closed: invoiceText('closed', {}, locale),
    };
}

// English is the initial application language; callers can select another complete catalog later.
export const invoiceLabels = getInvoiceLabels();

/** Give Joi the same catalog-owned language as the surrounding invoice workflow. */
export function getInvoiceValidationMessages(locale = 'en'): Record<string, string> {
    // Joi substitutes its own double-braced field placeholders after selecting our full message.
    // The wildcard also covers new validation rules without exposing distributed default English.
    return {
        '*': invoiceText('validationInvalid', {}, locale),
        'any.required': invoiceText('validationRequired', {}, locale),
        'number.positive': invoiceText('validationPositive', {}, locale),
        'number.precision': invoiceText('validationPrecision', {}, locale),
    };
}
