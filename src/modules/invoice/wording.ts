/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import {englishInvoiceCatalog} from './locales/en';
import type {InvoiceCatalog, InvoiceTextKey, InvoiceTextParameters, InvoiceTextFormatter} from '../../types/InvoicePoolTypes';

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
export function getInvoiceLabels(locale = 'en', text?: InvoiceTextFormatter) {
    /** Keep the existing catalog default while permitting an explicitly supplied interface translator. */
    function localizedText(key: InvoiceTextKey): string { return invoiceText(key, {}, locale); }
    text ??= localizedText;
    // This stable presentation contract selects catalog keys once; views and clients do not supply fallback labels.
    return {
        payer: text('payer'),
        base: text('base'),
        adjustments: text('adjustments'),
        invoiceCredit: text('invoiceCredit'),
        calculated: text('calculated'),
        previous: text('previous'),
        original: text('original'),
        settled: text('settled'),
        remaining: text('remaining'),
        due: text('due'),
        refund: text('refund'),
        settledStatus: text('settledStatus'),
        paymentCompleted: text('paymentCompleted'),
        refundCompleted: text('refundCompleted'),
        settledFilter: text('settledFilter'),
        recordPayment: text('recordPayment'),
        recordRefund: text('recordRefund'),
        reversePayment: text('reversePayment'),
        reverseRefund: text('reverseRefund'),
        paymentsDue: text('paymentsDue'),
        refundsDue: text('refundsDue'),
        netRemaining: text('netRemaining'),
        invoiceCosts: text('invoiceCosts'),
        redistributedAdjustments: text('redistributedAdjustments'),
        additionalAdjustments: text('additionalAdjustments'),
        distributable: text('distributable'),
        baseCalculation: text('baseCalculation'),
        calculationNotes: text('calculationNotes'),
        recordSettlement: text('recordSettlement'),
        reverseSettlement: text('reverseSettlement'),
        awaitingReview: text('awaitingReview'),
        accepted: text('accepted'),
        rejected: text('rejected'),
        retracted: text('retracted'),
        closed: text('closed'),
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
